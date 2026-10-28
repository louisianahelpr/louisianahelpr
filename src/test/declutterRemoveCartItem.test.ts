/**
 * A buyer can take an item out of their cart (Declutter audit 2 B2-4 / lead A2-8, 2026-10-28; migration
 * 20261028221904).
 *
 * THE CLASS. A cart line held its item for 48 hours with no way out but the deadline sweep (which strikes the buyer),
 * so the seller could not sell it to anyone else and a second "Buy now" from the same seller joined the first
 * checkout. declutter_remove_cart_item releases the hold the sweep's way, without the strike, for the caller's OWN
 * in-cart line only, never while its Stripe page can still be paid.
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs) and the newest cart status CHECK. Backend proof:
 * src/test/pglite/declutterRemoveCartItem.pglite.mjs (3x replay; 20 FAIL without the migration; RED on 7 planted
 * defects: anyone's line, no live-page refusal, order not superseded, item not released, no switch gate, anon
 * granted, a paid line removable).
 */
// @mutate supabase/migrations/20261028221904_declutter_remove_cart_item.sql |   SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.id = p_line_id AND c.buyer_id = v_uid; |   SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.id = p_line_id;
// @mutate supabase/migrations/20261028221904_declutter_remove_cart_item.sql |      AND o.created_at > now() - interval '35 minutes' THEN |      AND false THEN
// @mutate supabase/migrations/20261028221904_declutter_remove_cart_item.sql |   'removed'              -- the buyer took it out |   'gone'              -- the buyer took it out
// @mutate supabase/migrations/20261028221904_declutter_remove_cart_item.sql |   PERFORM public.require_feature('declutter');\n  IF v_uid IS NULL THEN |   IF v_uid IS NULL THEN
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const flat = (fn: string) => blankSqlComments(effectiveDefs(MIG_DIR).get(fn)?.stmt ?? "").replace(/\s+/g, " ");

/** The statuses of the NEWEST declutter_cart_items_status_check the migrations add (or the table's own, before). */
function cartStatuses(): string[] {
  let last = "";
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/ADD CONSTRAINT declutter_cart_items_status_check CHECK \(status IN \(([^)]*)\)\)/g)) last = m[1];
  }
  return [...last.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("Declutter: the buyer can take an item out of their cart (A2-8)", () => {
  const b = flat("declutter_remove_cart_item");

  it("reads the RPC and the status list (floors)", () => {
    expect(b.length).toBeGreaterThan(800);
    expect(cartStatuses().length).toBeGreaterThan(4);
  });

  it("'removed' is a cart status, and every earlier one is kept", () => {
    expect(cartStatuses().sort()).toEqual(["cancelled_by_seller", "in_cart", "missed", "paid", "removed"]);
  });

  it("behind the switch, the caller's own in-cart line only, never while its page can be paid", () => {
    expect(b).toMatch(/^.*?BEGIN PERFORM public\.require_feature\('declutter'\);/);
    expect(b).toContain("SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.id = p_line_id AND c.buyer_id = v_uid;");
    expect(b).toContain("IF v_status <> 'in_cart' THEN RAISE EXCEPTION 'not_in_cart'");
    expect(b).toMatch(/AND o\.created_at > now\(\) - interval '35 minutes' THEN RAISE EXCEPTION 'checkout_open'/);
  });

  it("releases the hold like the sweep, without the strike: line removed, unpaid order superseded, item back on sale", () => {
    expect(b).toContain("UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now() WHERE id = p_line_id AND status = 'in_cart';");
    expect(b).toContain("UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded'");
    expect(b).toContain("UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = l.item_id AND status = 'reserved';");
    expect(b).not.toContain("declutter_give_strike");
  });
});
