/** One payout_transfers row as the analytics read it. */
export type PayoutTransferRow = { amount_cents: number | string; status: string; job_id?: string | null };

/**
 * The payout_transfers select for analytics, with the job's seed flag as a LEFT
 * embed so a transfer whose job row is gone still counts.
 */
export const PAYOUT_TRANSFER_ANALYTICS_COLUMNS = "amount_cents, status, job_id, jobs(is_seed)";

/**
 * Real payouts only. Seed-filtered like the tips (owner 2026-10-12: test
 * accounts pay out on the Stripe TEST key, and those transfers sit on is_seed
 * jobs), and the embed is dropped so the rows keep their old shape.
 */
export function realPayoutTransfers(data: unknown): PayoutTransferRow[] {
  const rows = (data as (PayoutTransferRow & { jobs?: { is_seed?: boolean | null } | null })[] | null) || [];
  return rows
    .filter((t) => t.jobs?.is_seed !== true)
    .map(({ amount_cents, status, job_id }) => ({ amount_cents, status, job_id }));
}
