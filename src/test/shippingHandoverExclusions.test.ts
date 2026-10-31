/**
 * CLASS GUARD: every handover-generic path knows about 'ship' (docs/specs/shipping-draft.md section 11, money
 * review must-fix 1; Q2259). A Declutter function that tests the handover with a NOT IN list treats every value
 * it does not name as "the rest", so a new handover silently falls into it: before shipping S2, a shipped order
 * would have been closed as buyer_no_show 7 days after payment by declutter_handover_sweep, and its buyer handed
 * the seller's home address by declutter_address_access.
 *
 * Inventory from source: every `handover NOT IN (...)` in the EFFECTIVE (newest, rewrites applied, comments
 * blanked) definition of every public function. Each one either names 'ship' (the shipped order is excluded) or is
 * listed below as a REFUSAL (the list is the only handovers the function accepts, so 'ship' is refused). Exact both
 * ways: a new NOT IN without 'ship' fails until someone decides; a listed refusal that is gone fails too.
 *
 * Behaviour: src/test/pglite/shippingS2ShipHandover.pglite.mjs (sweep, booking, address, "I got it", fee rule).
 *
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |      WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND o2.paid_at | WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND o2.paid_at
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |                            AND o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer' |                            AND o.handover NOT IN ('seller_delivery', 'meetup')) THEN 'paid_buyer'
 * @mutate supabase/migrations/20261030000030_shipping_s2_ship_handover.sql |                        WHEN NEW.handover = 'ship' THEN 'f1_ship' | WHEN NEW.handover = 'shipX' THEN 'f1_ship'
 * @mutate supabase/migrations/20261030000030_shipping_s2_ship_handover.sql |   IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'ship') THEN | IF false THEN
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.handover = 'ship' AND NOT EXISTS ( | IF false AND NOT EXISTS (
 */
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { join } from "node:path";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

/** NOT IN lists that are the function's ONLY accepted handovers (anything else, 'ship' included, is refused). */
const REFUSALS: Record<string, string> = {
  "declutter_checkout_free|p_handover NOT IN ('pickup_home', 'porch')": "a free claim is porch or door pickup only; anything else raises",
  "declutter_accept_refund_with_return|o.handover NOT IN ('pickup_home', 'porch')": "a drop-off is only where the seller offered pickup; anything else, shipped included, raises drop_off_not_offered",
  "declutter_on_my_way|o.handover NOT IN ('pickup_home', 'porch', 'meetup')": "I'm on my way is for a pickup; anything else raises not_a_pickup",
  "declutter_seller_picked_up|o.handover NOT IN ('pickup_home', 'meetup')": "\"Picked up\" is for a door pickup or a meetup; anything else raises not_a_door_pickup",
  "declutter_start_checkout|p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup')":
    "checkout raises invalid_handover for anything else, so no member can open a shipped order until shipping S3 adds 'ship' here",
};

function notInLists(): string[] {
  const out: string[] = [];
  for (const [name, def] of DEFS) {
    for (const m of flat(def.stmt).matchAll(/([a-z_0-9]+\.)?(p_handover|handover) NOT IN \(([^)]*)\)/g)) {
      out.push(`${name}|${m[0]}`);
    }
  }
  return out.sort();
}

describe("every handover NOT IN list knows about 'ship' (shipping S2, must-fix 1)", () => {
  it("each list names 'ship' or is a listed refusal (two-way)", () => {
    const lists = notInLists();
    expect(lists.length).toBeGreaterThan(6);
    const missing = lists.filter((l) => !l.includes("'ship'") && !(l in REFUSALS));
    expect(missing, "a NOT IN list that would let a shipped order through").toEqual([]);
    const stale = Object.keys(REFUSALS).filter((k) => !lists.includes(k));
    expect(stale, "a listed refusal no longer in the code").toEqual([]);
  });

  it("the paths that reach money or an address exclude 'ship' explicitly", () => {
    const sweep = flat(DEFS.get("declutter_handover_sweep")!.stmt);
    expect(sweep.split("handover NOT IN ('delivery', 'seller_delivery', 'ship')").length - 1).toBe(4);
    expect(flat(DEFS.get("declutter_address_access")!.stmt)).toContain("o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer'");
    expect(flat(DEFS.get("declutter_orders_fee_rule_f1")!.stmt)).toContain("WHEN NEW.handover = 'ship' THEN 'f1_ship'");
    expect(flat(DEFS.get("declutter_bookings_not_delivery")!.stmt)).toContain("o.handover = 'ship') THEN RAISE EXCEPTION 'delivery_order'");
    expect(flat(DEFS.get("declutter_confirm_handover")!.stmt)).toContain(
      "IF o.handover = 'ship' AND NOT EXISTS ( SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'not_delivered_yet'");
  });
});
