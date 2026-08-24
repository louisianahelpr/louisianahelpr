export interface DisputedJob {
  id: string;
  title: string;
  budget: number;
  status: string;
  dispute_reason: string | null;
  dispute_evidence_urls: string[];
  disputed_at: string | null;
  disputed_by: string | null;
  customer_id: string;
  helper_id: string | null;
  stripe_payment_intent_id: string | null;
}

/** Row in the formal `public.disputes` table — null when the dispute
 *  predates the migration and we're reading from jobs.dispute_*. */
export interface DisputeRecord {
  id: string;
  job_id: string;
  opener_id: string;
  reason: string;
  evidence_urls: string[];
  status: "open" | "decided" | "withdrawn";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_text: string | null;
  payout_split: { poster?: number; helper?: number } | null;
  /**
   * Settlement state for the recorded split, written by the
   * `execute-dispute-split` edge function. Absent (undefined) on any row read
   * before that migration deployed — the queue keeps rendering either way, so
   * treat "undefined" as "not attempted", not as an error.
   */
  execution_status?: "pending" | "executing" | "executed" | "failed" | null;
  executed_at?: string | null;
  execution_transfer_id?: string | null;
  execution_refund_id?: string | null;
  /** What actually moved, in cents — reconciles against payout_transfers. */
  execution_helper_cents?: number | null;
  /** What actually went back to the poster, in cents — vs. payment_refunds. */
  execution_refund_cents?: number | null;
  execution_error?: string | null;
}

export type FilterTab = "open" | "decided";
export type AgeFilter = "all" | "0-24h" | "1-7d" | "7-30d" | ">30d";
export type PartyFilter = "all" | "poster" | "helper";
export type CategoryFilter = "all" | string;
