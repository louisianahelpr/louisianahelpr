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
 * RLS), so the database answers which jobs those are:
 * admin_gift_card_paid_job_ids() (migration 20261003050100, admin-only), read
 * by loadGiftCardPaidJobIds(). Every admin money read selects `id` and
 * `stripe_payment_intent_id` with its held status, marks rows with
 * withGiftCardPaid(), and keeps `.filter(isCapturedPayment)`.
 *
 * Not a computed field (the first Q443 fix, 20261002050635): PostgREST hands a
 * computed field the WHOLE jobs row, a whole-row reference needs SELECT on
 * every column, and authenticated may not read offered_to_helper_id
 * (20260915045110). Every admin money read 403'd until 20261003050100.
 */
export const CAPTURED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"] as const;

export function isCapturedPayment(job: {
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
  gift_card_paid?: boolean | null;
}): boolean {
  return (
    (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "") &&
    (!!job.stripe_payment_intent_id || job.gift_card_paid === true)
  );
}

/** Each row with `gift_card_paid` set from loadGiftCardPaidJobIds()'s answer. */
export function withGiftCardPaid<T extends { id: string }>(
  rows: readonly T[] | null | undefined,
  giftCardPaidJobIds: ReadonlySet<string>,
): (T & { gift_card_paid: boolean })[] {
  return (rows ?? []).map((row) => ({ ...row, gift_card_paid: giftCardPaidJobIds.has(row.id) }));
}
