/**
 * The one-time setup fee is never taken from a payout a send was already tried for, even after a rebook or an admin
 * release put its tries back to 0 (20261031200034): its Stripe key (declutter-payout-<id> / helpr-task-payout-<id>)
 * may already carry the old amount, and Stripe refuses the same key with a new amount. Review of the B49 rebuild,
 * 10-31, finding (2). Behaviour: src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs and
 * helprSetupFeeFromPayout.pglite.mjs (FOLLOWUP=skip is red on the new cases).
 *
 * @mutate supabase/migrations/20261031225132_setup_fee_never_after_a_send.sql | OR p.attempts > 0 OR p.send_tried\n     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id) THEN | OR p.attempts > 0 THEN
 * @mutate supabase/migrations/20261031225132_setup_fee_never_after_a_send.sql | OR p.helpr_id IS NULL OR p.send_tried\n     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'helpr_task' AND m.payout_id = p.id) THEN | OR p.helpr_id IS NULL THEN
 * @mutate supabase/migrations/20261031225132_setup_fee_never_after_a_send.sql |     OR (TG_OP = 'UPDATE' AND (OLD.send_tried OR COALESCE(OLD.attempts, 0) > 0)); | ;
 */
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";

const body = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");

describe("the setup fee is never taken after a send was tried", () => {
  it("the seller's take skips a row with send_tried or a send mark", () => {
    const b = body("declutter_payout_take_setup_fee");
    expect(b.length).toBeGreaterThan(200);
    expect(b).toContain("OR p.attempts > 0 OR p.send_tried OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id) THEN RETURN p.amount_cents;");
  });

  it("the delivery Helpr's take skips a row with send_tried or a send mark", () => {
    const b = body("helpr_task_payout_take_setup_fee");
    expect(b.length).toBeGreaterThan(200);
    expect(b).toContain("OR p.helpr_id IS NULL OR p.send_tried OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'helpr_task' AND m.payout_id = p.id) THEN RETURN p.amount_cents;");
  });

  it("the marker survives a reset of the tries", () => {
    const b = body("payout_send_tried_sticky");
    expect(b).toContain("NEW.send_tried := COALESCE(NEW.send_tried, false) OR COALESCE(NEW.attempts, 0) > 0 OR (TG_OP = 'UPDATE' AND (OLD.send_tried OR COALESCE(OLD.attempts, 0) > 0));");
  });
});
