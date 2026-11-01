/**
 * No Declutter notice says "at the time you chose" before a time is chosen (deep audit 2026-10-28, #26;
 * migration 20261028204431). A pickup is booked only after payment, so the paid notice ("Payment received", both
 * paths) and the free claim ("It's yours") arrived saying "pick up your items at the time you chose" with nothing
 * booked. The next step now comes from declutter_paid_next_step, which says "at the time you chose" only where a
 * booking with a time exists (a pickup booking, or a seller delivery the status trigger booked).
 *
 * The class: every "at the time you chose" in any effective Declutter function lives in declutter_paid_next_step
 * (exact, both ways), and each sits behind a check that a time exists. Reads the EFFECTIVE definitions.
 * Backend proof: src/test/pglite/declutterPaidNoticeNextStep.pglite.mjs (prod's bodies RED, 3x replay, 6 planted
 * defects RED).
 */
// @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql | format('You paid %s for %s. %s', public.declutter_price_text(p_amount_cents), public.declutter_order_items_named(p_order_id),\n           public.declutter_paid_next_step(p_order_id)), | format('You paid %s for %s. Next: pick up your items at the time you chose.', public.declutter_price_text(p_amount_cents), public.declutter_order_items_named(p_order_id)),
// @mutate supabase/migrations/20261031211922_free_claim_fee_then_id_restated.sql | 'Your free item is set. Next: choose when to pick it up. Nothing was charged.', | 'Your free item is set. Next: pick it up at the time you chose. Nothing was charged.',
// @mutate supabase/migrations/20261031163021_declutter_porch_next_step_is_a_time.sql |     WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN |     WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id) THEN
// @mutate supabase/migrations/20261031163021_declutter_porch_next_step_is_a_time.sql | WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL) | WHERE d.order_id = o.id)
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const DECLUTTER = [...DEFS.keys()].filter((fn) => fn.startsWith("declutter_"));

describe("no Declutter notice says \"at the time you chose\" before a time is chosen", () => {
  it("reads the Declutter functions (floor)", () => {
    expect(DECLUTTER.length).toBeGreaterThan(150);
  });

  it("\"the time you chose\" is said only by the step that checks a time exists", () => {
    const sayers = DECLUTTER.filter((fn) => /time you chose/.test(flat(fn))).sort();
    expect(sayers).toEqual(["declutter_paid_next_step"]);
    const step = flat("declutter_paid_next_step");
    expect(step).toContain("WHEN o.handover = 'seller_delivery' THEN CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL) THEN 'Next: the seller delivers at the time you chose.'");
    expect(step).toContain("WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN 'Next: pick up your items at the time you chose.'");
    expect(step).toContain("ELSE 'Next: choose your pickup time in Buying.'");
    // LEAD-PLACE-TIMES (owner 2026-10-31): a porch order books a time too, so no porch-only "pickup day" line.
    // @mutate supabase/migrations/20261031163021_declutter_porch_next_step_is_a_time.sql |     ELSE 'Next: choose your pickup time in Buying.' |     WHEN o.handover = 'porch' THEN 'Next: choose your pickup day in Buying.'\n    ELSE 'Next: choose your pickup time in Buying.'
    expect(step).not.toContain("pickup day");
    expect(step).toContain("WHEN o.handover = 'delivery' THEN 'Next: we''re finding a Helpr to bring it to your door. We''ll tell you when one takes it.'");
  });

  // BUY-1 (20261101030040): a payment on a released hold is refunded in full, so the "paid in time, the sale stands"
  // notice is gone and one "Payment received" notice is left.
  it("the \"Payment received\" notice takes its next step from it; the free claim says to choose", () => {
    const paid = flat("declutter_mark_order_paid");
    expect(paid.match(/public\.declutter_paid_next_step\(p_order_id\)/g)?.length).toBe(1);
    expect(paid).not.toMatch(/Next: /);
    expect(flat("declutter_checkout_free")).toContain("'Your free item is set. Next: choose when to pick it up. Nothing was charged.'");
  });
});
