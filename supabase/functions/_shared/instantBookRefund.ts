/**
 * CMP-4 (lead 2026-11-01, money re-review of 20261101071621:224-244): the
 * AUTOMATIC full refund of an instant booking that was charged and whose hire
 * was then refused.
 *
 * instant_book_captured_not_hired (20261101074901) has already, in one locked
 * write, closed the job (status 'cancelled', off the listing, nobody can be
 * hired) and taken the refund claim the cancel path uses: payment_status
 * 'cancelling' with the holder row job_refund_claims.claimed_by
 * 'instant_book_refund'. No other refund path can take that money:
 * cancel_escrow refuses a closed job and re-enters 'cancelling' only under its
 * own holder, admin_refund_general and void-cancelled-payments read 'escrow'.
 *
 * This refunds it, called right away by card-hold-sweep's settle and by
 * create-payment capture_hold (the Helpr's early confirm), and retried by
 * card-hold-sweep for every claim still open:
 *   - the claim must be this path's ('instant_book_refund'), else nothing;
 *   - the charge is read in Stripe; what it still holds (captured less what
 *     was already refunded) goes back, under a key made of the job and the
 *     already-refunded amount, so two runs at once send ONE refund and a run
 *     after a refund sends nothing (the charge reads fully refunded);
 *   - the $2 setup fee came back with it, so it is owed again;
 *   - instant_book_refund_finished closes the claim exactly once.
 * A Stripe answer that is not a definite "no" retries next run; a definite
 * "no" pages a person once and keeps the claim (the job stays closed, nothing
 * else can take the money).
 *
 * The poster was told "refunding your payment in full" when the job closed;
 * the charge.refunded webhook tells them the refund was sent and writes the
 * ledger row, as for every refund (stripe-webhook/handlers/chargeRefunded.ts).
 *
 * Stripe and the setup-fee put-back are injected, so the money paths are
 * proven without Stripe (src/test/instantBookRefund.test.ts).
 */
import { isDefinitiveStripeRefusal } from "./stripeRefusal.ts";

export const INSTANT_REFUND_HOLDER = "instant_book_refund";

export type InstantRefundOutcome =
  | "refunded" // the refund went out (now or before) and the claim closed
  | "none" // no claim of this path's on the job
  | "retry" // a read or write did not answer: the next run tries again
  | "needs_person"; // Stripe definitely refused, or the money is not where it should be: paged once

/** Only what this module reads of a Stripe PaymentIntent (retrieved with latest_charge expanded). */
export type InstantRefundPi = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number | null;
  latest_charge?: string | { amount_refunded?: number | null } | null;
};

export type InstantRefundDeps = {
  // deno-lint-ignore no-explicit-any
  db: any;
  stripe: {
    retrievePi: (piId: string) => Promise<InstantRefundPi>;
    refund: (params: { payment_intent: string; amount: number; metadata: Record<string, string> }, idempotencyKey: string) => Promise<{ id: string }>;
  };
  /** cardHold.ts unclaimSetupFee: the $2 setup fee claim goes back (matched on its own time). */
  unclaimSetupFee: (jobId: string, posterId: string | null, at: string | null) => Promise<void>;
  record: (defect: string) => void;
  page: (title: string, message: string, fields: Record<string, string | number | null | undefined>, onceKey: string) => Promise<unknown>;
};

export async function refundInstantBooking(deps: InstantRefundDeps, jobId: string): Promise<InstantRefundOutcome> {
  const { db } = deps;
  const { data: claim, error: claimErr } = await db.from("job_refund_claims").select("claimed_by").eq("job_id", jobId).maybeSingle();
  if (claimErr) {
    deps.record(`job ${jobId}: an instant booking's refund claim was not read (${claimErr.message}); retried next run`);
    return "retry";
  }
  if ((claim as { claimed_by?: string } | null)?.claimed_by !== INSTANT_REFUND_HOLDER) return "none";

  const { data: job, error: jobErr } = await db.from("jobs")
    .select("id, customer_id, status, payment_status, stripe_payment_intent_id").eq("id", jobId).maybeSingle();
  if (jobErr || !job) {
    deps.record(`job ${jobId}: an instant booking's refund could not read its job (${jobErr?.message ?? "no row"}); retried next run`);
    return "retry";
  }
  const row = job as { customer_id: string | null; status: string; payment_status: string | null; stripe_payment_intent_id: string | null };
  const stuck = async (why: string): Promise<InstantRefundOutcome> => {
    deps.record(`job ${jobId}: an instant booking's full refund needs a person: ${why}`);
    await deps.page(
      "An instant booking's automatic refund needs a person",
      `The job was charged for an instant booking whose hire did not complete. It is closed for review (status cancelled, payment_status 'cancelling', job_refund_claims holder '${INSTANT_REFUND_HOLDER}'), so nobody can be hired on it and no other refund path can take the money. The automatic full refund stopped: ${why}. Check the charge in Stripe and refund what it still holds in full.`,
      { job_id: jobId, payment_intent: row.stripe_payment_intent_id, payment_status: row.payment_status },
      `instant-book-refund-stuck:${jobId}`,
    );
    return "needs_person";
  };

  if (row.payment_status !== "refunded") {
    if (row.payment_status !== "cancelling") return stuck(`the job reads payment_status '${row.payment_status}', not 'cancelling'`);
    const piId = row.stripe_payment_intent_id;
    if (!piId) return stuck("the job carries no PaymentIntent");

    let pi: InstantRefundPi;
    try {
      pi = await deps.stripe.retrievePi(piId);
    } catch (e) {
      if (isDefinitiveStripeRefusal(e)) return stuck(`Stripe refused to read ${piId}: ${String((e as { message?: unknown }).message ?? e).slice(0, 200)}`);
      deps.record(`job ${jobId}: ${piId} was not read for an instant booking's refund (${String((e as { message?: unknown }).message ?? e).slice(0, 200)}); retried next run`);
      return "retry";
    }
    if (pi.status !== "succeeded") return stuck(`${piId} is ${pi.status}, not succeeded`);
    const capturedCents = Number(pi.amount_received ?? pi.amount);
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (!charge) return stuck(`${piId}'s charge was not read`);
    const alreadyRefundedCents = Number(charge.amount_refunded ?? 0);
    const remainingCents = capturedCents - alreadyRefundedCents;
    if (remainingCents > 0) {
      try {
        // own-mistake full refund (owner, 2026-10-14): the card was charged for
        // an instant booking whose hire was then refused, which the hold model
        // never allows (Q2399: charged only at a hire), so everything the
        // charge still holds goes back, card fee included.
        await deps.stripe.refund(
          { payment_intent: piId, amount: remainingCents, metadata: { job_id: jobId, card_hold: "1", why: "instant_booking_charged_not_hired" } },
          `instant-book-refund-${jobId}-r${alreadyRefundedCents}`,
        );
      } catch (e) {
        if (isDefinitiveStripeRefusal(e)) return stuck(`Stripe refused the refund: ${String((e as { message?: unknown }).message ?? e).slice(0, 200)}`);
        deps.record(`job ${jobId}: an instant booking's refund did not get a definite answer (${String((e as { message?: unknown }).message ?? e).slice(0, 200)}); retried next run under the same key`);
        return "retry";
      }
    }
  }

  // The setup fee came back with the refund: owed again. Before the claim
  // closes, so a failure here is retried (the next run sends no refund).
  const { data: hold, error: holdErr } = await db.from("job_card_holds").select("onboarding_fee_claimed_at").eq("job_id", jobId).maybeSingle();
  if (holdErr) {
    deps.record(`job ${jobId}: refunded, but its hold was not read to put the setup fee back (${holdErr.message}); retried next run`);
    return "retry";
  }
  const feeAt = (hold as { onboarding_fee_claimed_at?: string | null } | null)?.onboarding_fee_claimed_at ?? null;
  if (feeAt) {
    try {
      await deps.unclaimSetupFee(jobId, row.customer_id, feeAt);
    } catch (e) {
      deps.record(`job ${jobId}: refunded, but the setup fee was not put back (${String((e as { message?: unknown }).message ?? e).slice(0, 200)}); retried next run`);
      return "retry";
    }
  }
  const { data: done, error: doneErr } = await db.rpc("instant_book_refund_finished", { p_job_id: jobId });
  if (doneErr) {
    deps.record(`job ${jobId}: refunded, but the refund claim was not closed (${doneErr.message}); retried next run`);
    return "retry";
  }
  return done === true ? "refunded" : "none";
}
