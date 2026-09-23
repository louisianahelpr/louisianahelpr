export interface PayoutBatch {
  helper_id: string;
  helper_name: string | null;
  helper_email: string | null;
  stripe_account_id: string | null;
  job_count: number;
  total_payout: number;
  oldest_completed_at: string;
  /** The helper's profile is a seed profile (seedAware, Q233). */
  is_seed?: boolean;
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
  jobs: { title?: string; is_seed?: boolean | null } | null;
  profiles: { full_name?: string | null } | null;
}
