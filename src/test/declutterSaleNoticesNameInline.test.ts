/**
 * The seven sale notices name the item in their own words, and the buyer hears they can tip the delivery Helpr
 * (Declutter audits 2026-10-28, A3-8 / A2-18; migration 20261028210552). "Payment received", "Buyer paid",
 * "Helpr pickup booked", "Picked up", "Delivered", "Handover done" and "Enjoy your item" never said which item;
 * the notice writer's "Lamp: " prefix (20261028191646, guard declutterNoticesNameTheItem.test.ts) now names any
 * notice that does not, and these seven say it in the sentence, so the prefix adds nothing.
 *
 *   - every call writing one of those seven titles names the order's items (declutter_order_items_named), with
 *     the first item the writer's prefix would read (the order the items were added), so the name is never doubled;
 *   - the tip line rides on declutter_delivery_tip_open, which holds helpr_task_tip_start's own conditions.
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs (prod's
 * bodies md5-checked, 3x replay, RED before it and on 6 planted defects; the tip line shown exactly when
 * helpr_task_tip_start takes a tip).
 */
// @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | format('The Helpr left %s at the drop-off address. Tap "I got it", or report a problem within 24 hours.',\n             public.declutter_order_items_named(o.id)), | 'The Helpr left your item at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END | THEN '' ELSE '' END
// @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql |        AND NOT public.are_users_blocked(o.buyer_id, t.helpr_id)\n |
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) \|\|\n |
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

/** Every declutter_notify / _strict call in a Declutter function: [function, title, message]. */
function calls(): { fn: string; title: string; message: string }[] {
  const out: { fn: string; title: string; message: string }[] = [];
  for (const [fn, def] of DEFS) {
    if (!fn.startsWith("declutter_") || fn === "declutter_notify" || fn === "declutter_notify_strict") continue;
    const src = blankSqlComments(def.stmt);
    for (const m of src.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
      const args: string[] = [];
      let depth = 0, cur = "";
      for (let i = m.index! + m[0].length; i < src.length; i++) {
        const c = src[i];
        if (c === "'") { let j = i + 1; while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j += src[j] === "'" ? 2 : 1; cur += src.slice(i, j + 1); i = j; continue; }
        if (c === "(") depth++;
        if (c === ")") { if (depth === 0) { args.push(cur.trim()); break; } depth--; }
        if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      out.push({ fn, title: args[2] ?? "", message: (args[3] ?? "").replace(/\s+/g, " ") });
    }
  }
  return out;
}
const SEVEN = ["'Payment received'", "'Buyer paid'", "'Helpr pickup booked'", "'Picked up'", "'Delivered'", "'Handover done'", "'Enjoy your item'"];

describe("Declutter sale notices name the item", () => {
  const all = calls();

  it("reads the call sites (floor)", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("the seven named in the audit name the order's items, every call", () => {
    const hits = all.filter((c) => SEVEN.includes(c.title));
    expect(hits.length).toBe(10); // Payment received 1, Buyer paid 1 (BUY-1, 20261101030040: a payment that lands after the hold ended is refunded in full, so declutter_mark_order_paid no longer has the late "sale stands" pair), Helpr pickup booked 1, Picked up 1, Delivered 2 (the seller too since LEAD-BUY44, 20261031140431), Handover done 2, Enjoy your item 2
    expect(hits.filter((c) => !/declutter_order_items_named\((p_order_id|o\.id)\)/.test(c.message)).map((c) => `${c.fn}: ${c.title}`)).toEqual([]);
    expect(flat("declutter_order_items_named")).toContain("WHEN 2 THEN format('\"%s\" and \"%s\"'");
  });

  it("after a Helpr delivery the buyer is told they can tip, only when a tip can be taken", () => {
    const enjoy = all.filter((c) => c.title === "'Enjoy your item'" && /tip/.test(c.message));
    expect(enjoy.map((c) => c.fn)).toEqual(["declutter_complete_handover"]);
    expect(enjoy[0].message).toContain("CASE WHEN public.declutter_delivery_tip_open(o.id) THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END");
    const open = flat("declutter_delivery_tip_open");
    const start = flat("helpr_task_tip_start");
    // The same conditions helpr_task_tip_start checks after the caller's own (confirmed, a Helpr who is not the
    // buyer and not blocked, pay waiting for a Helpr with no payout account).
    expect(start).toContain("IF t.status <> 'confirmed' THEN RAISE EXCEPTION 'tip_not_yet'");
    expect(start).toContain("IF t.helpr_id IS NULL OR t.helpr_id = v_uid OR public.are_users_blocked(v_uid, t.helpr_id) THEN");
    expect(start).toContain("p.status IN ('pending', 'failed', 'held_for_review')");
    expect(open).toContain("AND t.status = 'confirmed'");
    expect(open).toContain("AND t.helpr_id IS NOT NULL AND t.helpr_id <> o.buyer_id AND NOT public.are_users_blocked(o.buyer_id, t.helpr_id)");
    expect(open).toContain("p.status IN ('pending', 'failed', 'held_for_review')");
  });

  it("names the same first item the writer's prefix reads, so it never names it twice", () => {
    const writer = flat("declutter_notice_names_item");
    expect(writer).toContain("(array_agg(btrim(i.title) ORDER BY c.created_at, c.id))[1]");
    expect(writer).toContain("position(v_first IN COALESCE(p_message, '')) > 0 THEN RETURN p_message;");
    const mine = flat("declutter_order_items_named");
    expect(mine.match(/array_agg\(i\.title ORDER BY c\.created_at, c\.id\)\)\[1\]/g)?.length).toBe(3);
    expect(mine).not.toMatch(/ORDER BY i\.title/);
  });
});
