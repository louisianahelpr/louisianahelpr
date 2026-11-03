export interface PayoutBatch {
  helper_id: string;
  helper_name: string | null;
  helper_email: string | null;
  stripe_account_id: string | null;
  job_count: number;
  total_payout: number;
  oldest_completed_at: string;
  /** Q233: the helper is a seed account (resolved client-side). */
  is_seed?: boolean;
  /**
   * Q2088: every job in the batch pays in Stripe TEST mode, by release-payout's rule (admin_payout_batch_money_modes:
   * the stored session prefix, else every party enrolled in test_accounts). Labels money only; is_seed still decides
   * whether the row is shown. Undefined when that read failed or is not deployed yet: the label falls back to is_seed.
   */
  money_test?: boolean;
}

export interface PayoutLedgerRow {
  id: string;
  helper_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  status: "pending" | "paid" | "failed" | "reversed";
  created_at: string;
  failure_reason: string | null;
  stripe_transfer_id: string | null;
  initiated_by: string | null;
  jobs: { title?: string } | null;
  profiles: { full_name?: string | null; is_seed?: boolean | null } | null;
}
