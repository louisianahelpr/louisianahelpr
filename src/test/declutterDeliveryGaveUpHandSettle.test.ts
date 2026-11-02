/**
 * Q1931 parts 2 and 3: a Declutter delivery row that used its 12 tries (a Helpr's delivery pay, a delivery-fee
 * refund) is listed in Payouts held for review and settled by hand there (admin only), so a delivery-fee refund sent
 * in Stripe is recorded (and counted by declutter_order_refunds_recorded_cents), and a Helpr's gave-up pay, once
 * paid, stops blocking the account deletion. A row still being retried, or pending, is refused.
 * Backend proof: src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs (3x; red on the 20261019112103
 * versions and on its planted defects).
 *
 * @mutate supabase/migrations/20261102043754_declutter_delivery_gave_up_hand_settle.sql | AND v_status = 'failed' AND v_attempts >= 12) THEN | AND v_attempts >= 12) THEN
 * @mutate supabase/migrations/20261102043754_declutter_delivery_gave_up_hand_settle.sql |        WHERE d.status = 'failed' AND d.attempts >= 12 |        WHERE d.status = 'failed' AND d.attempts >= 99
 * @mutate supabase/migrations/20261102043754_declutter_delivery_gave_up_hand_settle.sql |        WHERE p.status = 'failed' AND p.attempts >= 12 |        WHERE p.status = 'failed' AND p.attempts >= 11
 * @mutate supabase/migrations/20261102043754_declutter_delivery_gave_up_hand_settle.sql | p_kind IN ('helpr_task', 'delivery_refund') AND v_status = 'failed' | p_kind IN ('helpr_task', 'delivery_refund', 'declutter') AND v_status = 'failed'
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = (name: string) => flat(blankSqlComments(defs.get(name)?.stmt ?? ""));

describe("Declutter delivery money that gave up can be settled by hand", () => {
  it("the held list carries gave-up delivery pay and delivery-fee refunds, flagged", () => {
    expect(defs.size).toBeGreaterThan(500);
    const list = body("admin_payouts_held_for_review");
    expect(list.length).toBeGreaterThan(2000);
    expect(list).toContain("FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'failed' AND p.attempts >= 12");
    expect(list).toContain("FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'failed' AND d.attempts >= 12");
    expect((list.match(/'gave_up: ' \|\| COALESCE/g) ?? []).length).toBe(2);
    expect(list).toContain("false AS gave_up");
  });

  it("the settle takes a held row, or a failed delivery row at its 12-try cap and nothing else", () => {
    const settle = body("admin_payout_settle_by_hand");
    expect(settle).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin_only'");
    expect(settle).toContain("IF v_status IS DISTINCT FROM 'held_for_review' AND NOT (p_kind IN ('helpr_task', 'delivery_refund') AND v_status = 'failed' AND v_attempts >= 12) THEN RAISE EXCEPTION 'not_held_for_review'");
    // The cap matches the queues', which stop offering a row at 12 tries.
    for (const q of ["helpr_task_payouts_due", "declutter_delivery_refunds_due"]) {
      expect(flat(defs.get(q)?.stmt ?? "")).toContain("attempts < 12");
    }
    // Release still takes only held rows (a gave-up row is never re-queued with a spent try count).
    expect(body("admin_payout_release")).toContain("IF v_status IS DISTINCT FROM 'held_for_review' THEN RAISE EXCEPTION 'not_held_for_review'");
  });
});
