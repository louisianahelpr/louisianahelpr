/**
 * THE definition of "a payment we actually collected" — one place, read by
 * every admin money KPI (Dashboard home and Analytics).
 *
 * Q233: "Payments Collected" used to count any job whose `payment_status` sat
 * in escrow/payout_pending/released. A status is a claim; the Stripe
 * PaymentIntent is the evidence. The two card-capture paths write the PI in
 * the same UPDATE that sets the status (stripe-webhook checkoutSessionCompleted,
 * charge-recurring-visits). KNOWN GAP (Q409): a job paid IN FULL by a gift card
 * (redeem_gift_card) goes to escrow with no job PI — its money came through the
 * gift card's own PI — so it is not counted here yet. None exists outside seed
 * data on 2026-09-26. Otherwise a held-status row with NO PI is a row nobody
 * charged: on prod 2026-09-26, 19 seed jobs worth $2,720 of budget sat in a
 * captured status with `stripe_payment_intent_id IS NULL`. Counting them put
 * money on a tile that never moved through Stripe.
 */
export const CAPTURED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"] as const;

export function isCapturedPayment(job: {
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
}): boolean {
  return (
    (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "") &&
    !!job.stripe_payment_intent_id
  );
}
