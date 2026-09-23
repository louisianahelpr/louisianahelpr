/**
 * "Payments Collected" — one definition for Dashboard and Analytics (Q233).
 *
 * The tile summed every job in escrow / payout_pending / released. A job
 * reaches escrow two ways: a Stripe checkout (checkoutSessionCompleted and
 * charge-recurring-visits both write `stripe_payment_intent_id` alongside
 * `payment_status = 'escrow'`), or a gift-card redemption (redeem_pif_credit
 * sets escrow with NO PaymentIntent: that money was collected when the card
 * was bought, not on this job). Counting both as "payments collected" double-
 * counted credit-funded jobs and mixed in any escrow row nothing ever charged.
 *
 * So the tile counts card-captured jobs only, and the rest is reported beside
 * it as its own figure rather than dropped. Callers pass non-seed jobs.
 */
export const CAPTURED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"] as const;

export interface PaymentJob {
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
  budget?: number | null;
  customer_fee_amount?: number | null;
}

const gross = (j: PaymentJob) => Number(j.budget || 0) + Number(j.customer_fee_amount || 0);

export function splitPaymentsCollected<T extends PaymentJob>(jobs: readonly T[]) {
  const captured = jobs.filter((j) => (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(j.payment_status || ""));
  const cardJobs = captured.filter((j) => !!j.stripe_payment_intent_id);
  const noIntentJobs = captured.filter((j) => !j.stripe_payment_intent_id);
  return {
    cardJobs,
    /** Budget + poster fee on jobs Stripe actually charged. */
    cardGross: cardJobs.reduce((s, j) => s + gross(j), 0),
    noIntentJobs,
    /** Budget + poster fee on escrow jobs with no PaymentIntent (gift-card funded, or unrecorded). */
    noIntentGross: noIntentJobs.reduce((s, j) => s + gross(j), 0),
  };
}
