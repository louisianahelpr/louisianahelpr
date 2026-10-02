/**
 * THE definition of "a payment we actually collected" — one place, read by
 * every admin money KPI (Dashboard home and Analytics).
 *
 * Q233: "Payments Collected" used to count any job whose `payment_status` sat
 * in escrow/payout_pending/released. A status is a claim; the Stripe
 * PaymentIntent is the evidence. The two card-capture paths write the PI in
 * the same UPDATE that sets the status (stripe-webhook checkoutSessionCompleted,
 * charge-recurring-visits). A held-status row with NO PI is usually a row nobody
 * charged: on prod 2026-09-26, 19 seed jobs worth $2,720 of budget sat in a
 * captured status with `stripe_payment_intent_id IS NULL`. Counting them put
 * money on a tile that never moved through Stripe.
 *
 * Q443: the one real exception is a job a gift card paid IN FULL —
 * redeem_gift_card sets it to escrow with no job PI, because the money came
 * through the gift card's own PI. Admins cannot read gift_cards (party-only
 * RLS), so the database answers: the `payment_captured` computed field
 * (migration 20261002050635) is "held status AND (job PI OR, for an admin, a
 * redeemed paid gift card for this job)". Every admin money read filters
 * `.filter("payment_captured", "eq", true)`; rows read with that field selected are
 * judged by it here.
 */
export const CAPTURED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"] as const;

export function isCapturedPayment(job: {
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_captured?: boolean | null;
}): boolean {
  return (
    (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "") &&
    (!!job.stripe_payment_intent_id || job.payment_captured === true)
  );
}
