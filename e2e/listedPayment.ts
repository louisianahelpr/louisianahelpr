/**
 * Q2399: the payment states in which a job is POSTED and payable: funded, or
 * its card held (card_hold_at_post; SQL twin public.job_payment_is_listed).
 * Pure (no Playwright), so the fixture planners that vitest pins can use it.
 */
export const LISTED_PAYMENT_STATUSES = new Set(["escrow", "payout_pending", "released", "held"]);

export function isListedPayment(status: string | null | undefined): boolean {
  return LISTED_PAYMENT_STATUSES.has(status ?? "");
}
