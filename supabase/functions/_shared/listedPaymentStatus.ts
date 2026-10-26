/**
 * Q2399: the payment states in which a job is LISTED (browse, alerts, apply):
 * funded (escrow, payout_pending, released) or its card held ('held'). The
 * SQL twin is public.job_payment_is_listed (20261026152524). A hire
 * COMPLETING needs captured money, the funded three only.
 * src/test/fundedSetsAreClassified.test.ts holds every reader of these sets.
 */
export const FUNDED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"] as const;
export const LISTED_PAYMENT_STATUSES = [...FUNDED_PAYMENT_STATUSES, "held"] as const;

export function paymentIsListed(status: string | null | undefined): boolean {
  return (LISTED_PAYMENT_STATUSES as readonly string[]).includes(status ?? "");
}
