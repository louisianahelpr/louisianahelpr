/**
 * Shops Helpr delivery (Builder 5, 11-07): the shop card finds the order's Helpr task (shops_order_helpr_task) and
 * reads the booked pickup time through helpr_task_view. Reads the EFFECTIVE (newest) definitions; behaviour on a real
 * database is src/test/pglite/shopsOrderHelprTask.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red). The screens:
 * src/components/shops/shopHelprDeliveryScreens.test.tsx (4).
 *   - only the order's shop owner or buyer gets an id; anyone else: order_not_found;
 *   - only a 'shop_delivery' task of that order (a Declutter task never answers);
 *   - helpr_task_view answers the shop because the shop owner is the task's pickup contact.
 *
 * @mutate supabase/migrations/20261107164311_shops_order_helpr_task.sql |   IF NOT FOUND OR (o.seller_id IS DISTINCT FROM v_uid AND o.buyer_id IS DISTINCT FROM v_uid) THEN |   IF NOT FOUND THEN
 * @mutate supabase/migrations/20261107164311_shops_order_helpr_task.sql | WHERE t.source_kind = 'shop_delivery' AND t.source_id = o.id | WHERE t.source_id = o.id
 * @mutate supabase/migrations/20261107164311_shops_order_helpr_task.sql |   PERFORM public.require_feature('shops');\n |
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("the shop finds the order's Helpr task", () => {
  it("reads the newest definitions (floor)", () => {
    expect(DEFS.size).toBeGreaterThan(1000);
    for (const fn of ["shops_order_helpr_task", "helpr_task_view", "shop_delivery_open_task"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("only the shop owner or the buyer, behind the shops switch; only that order's shop task", () => {
    const f = flat("shops_order_helpr_task");
    expect(f).toContain("PERFORM public.require_feature('shops');");
    expect(f).toContain("IF NOT FOUND OR (o.seller_id IS DISTINCT FROM v_uid AND o.buyer_id IS DISTINCT FROM v_uid) THEN RAISE EXCEPTION 'order_not_found'");
    expect(f).toContain("WHERE t.source_kind = 'shop_delivery' AND t.source_id = o.id");
    expect(f).toMatch(/RETURNS uuid/);
  });

  it("helpr_task_view answers the shop: the shop owner is the task's pickup contact", () => {
    expect(flat("helpr_task_view")).toContain("WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact'");
    // helpr_task_create's 16th argument is the pickup contact: the order's seller.
    expect(flat("shop_delivery_open_task")).toContain("o.delivery_miles::integer, o.delivery_cents, o.buyer_id, o.seller_id,");
  });
});
