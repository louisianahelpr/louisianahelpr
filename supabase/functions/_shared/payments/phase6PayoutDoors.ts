/**
 * Phase 6's door onto the admin "Pay this Helpr" queue for a late-cancellation fee's Helpr share
 * (PayPal Plan A). Phase 6 does not own the writer; it calls it with the exact amounts its money
 * rules decided:
 *
 *   public.paypal_queue_manual_payout(p_job_id, p_helper_id, p_amount_cents, p_platform_fee_cents,
 *     p_initiated_by, p_initiated_by_user_id, p_source 'cancellation_fee')   (phase 4, migration
 *     20261023231811, lane pp-phase4): queued while the cancelled job's money is still held
 *     ('escrow'); a repeat visit's payment is found by funds_job_id. Mark paid does not flip a
 *     cancelled job's payment_status; the cancel sweep flips it right after queuing.
 *
 * Phase 4's TypeScript helper (manualPayoutQueue.ts queueManualPaypalPayout) is not used: it prices
 * the RELEASE share from the job's budget, and a cancellation fee is not that (lead 2026-10-23: a
 * direct RPC call with exact amounts). Its answers are read the way its own isQueued() reads them:
 * queued, queued_held, already_queued = done. Auto-tips do not come here: they go through the tips
 * lane's tip shape (paypalAutoTip.ts).
 *
 * A missing RPC or an error is never "queued": the sweep keeps the job in escrow and retries next
 * run; the poster's refund is never re-sent. Callers depend on the ManualPayoutQueue interface so
 * tests swap in an in-memory door.
 */

export type ManualPayoutSource = "cancellation_fee";

export interface QueueManualPayoutInput {
  jobId: string;
  helperId: string;
  /** What the Helpr receives, integer cents (> 0). */
  amountCents: number;
  /** What the platform keeps out of the gross this payout comes from, integer cents (>= 0). */
  platformFeeCents: number;
  source: ManualPayoutSource;
  /** The provider_payments row the money sits in (the job's own, or the visit's that funds it). */
  providerPaymentId: string;
}

export type QueueOutcome = "queued" | "queued_held" | "already_queued" | "waiting_for_payee" | "held" | "refused";

export interface QueueManualPayoutResult {
  outcome: QueueOutcome;
  reason: string | null;
  payoutId: string | null;
  /** True when a provider_payouts row now holds this money (phase 4's isQueued set, with its id). */
  recorded: boolean;
}

export interface ManualPayoutQueue {
  queue(input: QueueManualPayoutInput): Promise<QueueManualPayoutResult>;
}

/** The supabase-js call this needs (service-role client). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

function cents(n: number, what: string, min: number): number {
  if (!Number.isInteger(n) || n < min) throw new Error(`${what} must be an integer >= ${min}: ${n}`);
  return n;
}

/** The default door: phase 4's RPC. A missing RPC or an error is `refused`, never `queued`. */
export function rpcManualPayoutQueue(db: RpcClient): ManualPayoutQueue {
  return {
    async queue(input) {
      cents(input.amountCents, "amountCents", 1);
      cents(input.platformFeeCents, "platformFeeCents", 0);
      const { data, error } = await db.rpc("paypal_queue_manual_payout", {
        p_job_id: input.jobId,
        p_helper_id: input.helperId,
        p_amount_cents: input.amountCents,
        p_platform_fee_cents: input.platformFeeCents,
        p_initiated_by: "system",
        p_initiated_by_user_id: null,
        p_source: input.source,
      });
      if (error) {
        // PGRST202 / 42883: phase 4 not deployed yet. Anything else: an error. Neither queued money.
        const missing = error.code === "PGRST202" || error.code === "42883";
        return { outcome: "refused", reason: missing ? "queue_writer_not_deployed" : `rpc_error: ${error.message}`, payoutId: null, recorded: false };
      }
      return parseQueueAnswer(data);
    },
  };
}

const OUTCOMES: readonly QueueOutcome[] = ["queued", "queued_held", "already_queued", "waiting_for_payee", "held", "refused"];

/** Reads the RPC's jsonb answer. Anything unrecognised is `refused` (fail closed). */
export function parseQueueAnswer(data: unknown): QueueManualPayoutResult {
  const d = (data ?? {}) as { outcome?: unknown; reason?: unknown; payout_id?: unknown };
  const outcome = OUTCOMES.find((o) => o === d.outcome);
  if (!outcome) return { outcome: "refused", reason: `unrecognised_answer: ${JSON.stringify(data)?.slice(0, 120)}`, payoutId: null, recorded: false };
  const payoutId = typeof d.payout_id === "string" ? d.payout_id : null;
  // "Recorded" means a provider_payouts row holds the money, named by its id: phase 4's isQueued()
  // set (queued, queued_held, already_queued). Its "held" is a refusal (payout_held): no row.
  const recorded = (outcome === "queued" || outcome === "queued_held" || outcome === "already_queued") && payoutId !== null;
  return { outcome, reason: typeof d.reason === "string" ? d.reason : null, payoutId, recorded };
}
