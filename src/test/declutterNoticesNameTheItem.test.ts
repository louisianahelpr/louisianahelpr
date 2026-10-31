/**
 * Declutter notices name the item (Declutter audit 2, SH2-1; migration 20261028191646).
 *
 * THE CLASS. suppress_exact_duplicate_notification drops a notice word-for-word equal to one sent to the same
 * member in the last 10 minutes. A Declutter notice that does not name its item reads the same for every
 * order, so a second order's "You missed your pickup", "Pickup booked" or "Enjoy your item" was dropped (5 rows on 2026-10-28
 * in notification_dedupe_suppressions in the audit run). The one writer, declutter_notify_strict, now puts the
 * item's name in front of the message when the transaction has locked an order (declutter_lock_order records
 * it, transaction-local) whose two people are exactly the notice's user and counterpart; otherwise the text is
 * unchanged, so a wrong item is never named.
 *
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterNoticesNameTheItem.pglite.mjs (3x replay; red without the migration, where the
 * second order's notice is suppressed; red on 4 planted defects: no party check, the lock not recording the
 * order, a session-wide value, an item named twice).
 */
// @mutate supabase/migrations/20261028191646_declutter_notices_name_the_item.sql |   PERFORM public.declutter_notice_about(o.id);\n  RETURN o; |   RETURN o;
// @mutate supabase/migrations/20261028191646_declutter_notices_name_the_item.sql |   SELECT set_config('declutter.notice_order', COALESCE(p_order_id::text, ''), true); |   SELECT set_config('declutter.notice_order', COALESCE(p_order_id::text, ''), false);
// @mutate supabase/migrations/20261028191646_declutter_notices_name_the_item.sql |      AND ((o.buyer_id = p_user AND o.seller_id = p_other) OR (o.seller_id = p_user AND o.buyer_id = p_other)); | ;
// @mutate supabase/migrations/20261031111949_declutter_notices_open_the_order.sql |           public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link); |           public.declutter_price_words(p_message), v_link);
// @mutate supabase/migrations/20261028191646_declutter_notices_name_the_item.sql |   AFTER INSERT OR UPDATE ON public.declutter_orders\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_notice_about(); |   AFTER DELETE ON public.declutter_orders\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_notice_about();
// @mutate supabase/migrations/20261028191646_declutter_notices_name_the_item.sql | CREATE TRIGGER trg_declutter_orders_a_notice_about | CREATE TRIGGER trg_declutter_orders_z_notice_about
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

/** The AFTER row triggers the migrations leave on public.declutter_orders: name -> its event text. */
function orderAfterTriggers(): Map<string, string> {
  const live = new Map<string, string>();
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8")).replace(/\s+/g, " ");
    for (const m of sql.matchAll(/DROP TRIGGER IF EXISTS (\w+) ON public\.declutter_orders|CREATE TRIGGER (\w+) (AFTER [^;]*?) ON public\.declutter_orders/g)) {
      if (m[1]) live.delete(m[1]);
      else live.set(m[2], m[3]);
    }
  }
  return live;
}

describe("Declutter notices name the item, and only the right one", () => {
  const fns = ["declutter_lock_order", "declutter_notice_about", "declutter_notice_names_item", "declutter_notify_strict"];
  // (declutter_orders_notice_about, the trigger function, is read in its own test below.)

  it("reads the four definitions (floor)", () => {
    const read = fns.filter((f) => flat(f).length > 100);
    expect(read).toEqual(fns);
    expect(read.length).toBeGreaterThan(3);
  });

  it("locking an order records it for this transaction only", () => {
    expect(flat("declutter_lock_order")).toMatch(/PERFORM public\.declutter_notice_about\(o\.id\); RETURN o;/);
    // set_config's third argument true = transaction-local: never carried into the next request.
    expect(flat("declutter_notice_about")).toContain("set_config('declutter.notice_order', COALESCE(p_order_id::text, ''), true)");
  });

  it("the item is named only when the order's buyer and seller are the notice's two people", () => {
    const b = flat("declutter_notice_names_item");
    expect(b).toContain("AND ((o.buyer_id = p_user AND o.seller_id = p_other) OR (o.seller_id = p_user AND o.buyer_id = p_other))");
    expect(b).toMatch(/p_other IS NULL OR p_link IS NULL OR p_link NOT LIKE '\/declutter%'/);
    // Never twice: a message that already names the item is left alone.
    expect(b).toContain("position(v_first IN COALESCE(p_message, '')) > 0 THEN RETURN p_message;");
  });

  it("a write to an order records it, before any other AFTER trigger on the order can notify", () => {
    const trg = orderAfterTriggers();
    expect(trg.size).toBeGreaterThan(2);
    expect(trg.get("trg_declutter_orders_a_notice_about")).toBe("AFTER INSERT OR UPDATE");
    expect(flat("declutter_orders_notice_about")).toContain("PERFORM public.declutter_notice_about(NEW.id);");
    // Postgres fires same-event row triggers in name order: ours must come first.
    const before = [...trg.keys()].filter((n) => n !== "trg_declutter_orders_a_notice_about" && n < "trg_declutter_orders_a_notice_about");
    expect(before).toEqual([]);
  });

  it("the one writer passes every message through it", () => {
    expect(flat("declutter_notify_strict")).toContain(
      "public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link);" /* DC-17: the rewritten link (20261030133115) */);
  });
});
