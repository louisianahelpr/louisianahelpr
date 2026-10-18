/**
 * A job whose bank (ACH) payment is on its way: the poster finished Checkout,
 * the bank has not settled yet (owner, 2026-10-17: "The job shouldn't post
 * until the money is paid").
 *
 * The shape, from stripe-webhook's checkoutSessionCompleted: an async checkout
 * stores the PaymentIntent on the job and leaves payment_status 'unpaid' until
 * payment_intent.succeeded moves it to 'escrow'; a bounce moves it to
 * 'failed'. A checkout that never completed has no PaymentIntent on the row,
 * so it stays an unfunded draft that My Posts does not show
 * (NEVER_PAID_STATUSES). This job is not a post either (no bucket, no count),
 * but the poster sees it waiting: PendingBankPayments.
 */
export function jobAwaitsBankPayment(j: {
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
  status?: string | null;
}): boolean {
  return j.payment_status === "unpaid" && !!j.stripe_payment_intent_id && j.status !== "cancelled";
}
