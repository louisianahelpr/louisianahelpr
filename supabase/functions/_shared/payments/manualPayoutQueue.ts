/**
 * The ONE door phase 6 uses to put a Helpr's money on the admin "Pay this Helpr"
 * queue (PayPal Plan A; the queue and its writer are phase 4's, lane pp-phase4).
 *
 * STUB INTERFACE, BUILT AGAINST THE LEAD'S CONTRACT (2026-10-23), because phase 4's
 * writer was not on origin when phase 6 was built:
 *
 *   public.paypal_queue_manual_payout(
 *     p_job_id uuid, p_helper_id uuid, p_amount_cents integer, p_platform_fee_cents integer,
 *     p_initiated_by text DEFAULT 'system', p_initiated_by_user_id uuid DEFAULT NULL,
 *     p_source text DEFAULT 'release') RETURNS jsonb
 *   -> { outcome: queued|already_queued|waiting_for_payee|held|refused, reason, payout_id,
 *        payout_transfer_id, amount_cents, env }     service_role only.
 *
 * Phase 6 calls it with p_source 'cancellation_fee' (a late-cancel fee's Helpr share) and
 * 'auto_tip' (an automatic tip, 100% to the Helpr). Phase 4's preconditions today are
 * status='completed' AND payment_status='payout_pending', so BOTH sources need phase 4 to
 * widen them (the exact states are listed in PHASE6_QUEUE_PRECONDITIONS below and in the
 * phase 6 report). Until then the RPC answers `refused` (or is missing), which callers treat
 * as "not settled, retry next run": no money is lost, the poster's side is never re-done.
 *
 * Callers depend on the `ManualPayoutQueue` interface, never on the RPC name, so swapping the
 * stub for phase 4's real writer (or a later payout API) touches this file only.
 */

export type ManualPayoutSource = "cancellation_fee" | "auto_tip";

export interface QueueManualPayoutInput {
  jobId: string;
  helperId: string;
  /** What the Helpr receives, integer cents (> 0). */
  amountCents: number;
  /** What the platform keeps out of the gross this payout comes from, integer cents (>= 0). */
  platformFeeCents: number;
  source: ManualPayoutSource;
  /**
   * The provider_payments row the money sits in: the job's own payment for a cancellation fee
   * (phase 4's writer finds it by job), the TIP's payment for an auto-tip.
   */
  providerPaymentId: string;
  /**
   * An auto-tip only: the capture of the tip's payment, as PayPal answered it. The tips lane's
   * recorder (paypal_record_tip_capture) checks it against the row before it queues the payout.
   */
  tipCapture?: { providerOrderId: string; providerCaptureId: string; amountCents: number; settled: boolean };
}

export type QueueOutcome = "queued" | "already_queued" | "waiting_for_payee" | "held" | "refused";

export interface QueueManualPayoutResult {
  outcome: QueueOutcome;
  reason: string | null;
  payoutId: string | null;
  /** True when a provider_payouts row now holds this money (queued, already_queued, held). */
  recorded: boolean;
}

export interface ManualPayoutQueue {
  /**
   * Whether this queue can record a payout of this source at all. Asked BEFORE money is taken
   * from a payer for it (an auto-tip is not charged when its payout could not be queued).
   */
  supports(source: ManualPayoutSource): boolean;
  queue(input: QueueManualPayoutInput): Promise<QueueManualPayoutResult>;
}

/**
 * Auto-tip payouts go through the tips lane's recorder, public.paypal_record_tip_capture
 * (wip/pp-tips, migration 20261023232059): it marks the tip paid and queues ONE manual payout
 * named by tip_id (no payout_transfers claim, so it never collides with the job's own payout;
 * provider_payouts_one_live_per_tip). Phase 4's writer is not used for tips: it answers
 * already_queued for the JOB's payout claim.
 */
export const QUEUE_TAKES_TIP_PAYMENTS = true;

/**
 * The job/payment states each phase 6 source arrives in, for phase 4 to widen its
 * preconditions to (the lead asked for these exactly).
 */
export const PHASE6_QUEUE_PRECONDITIONS: Readonly<Record<ManualPayoutSource, string>> = {
  cancellation_fee:
    "jobs.status = 'cancelled' AND jobs.payment_status = 'escrow' (the sweep queues the fee BEFORE it flips the job to 'refunded'); " +
    "provider_payments (subject_kind 'job' for the job, or 'recurring_visit' with funds_job_id = the job) in 'partially_refunded' (or 'captured' when nothing went back); " +
    "jobs.helper_id = p_helper_id and jobs.helper_confirmed_at IS NOT NULL",
  auto_tip:
    "not phase 4's writer: paypal_record_tip_capture (tips lane) queues the tip's payout by tip_id",
};

/** The supabase-js call this needs (service-role client). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

function cents(n: number, what: string, min: number): number {
  if (!Number.isInteger(n) || n < min) throw new Error(`${what} must be an integer >= ${min}: ${n}`);
  return n;
}

/** The default queue: phase 4's RPC. A missing RPC or an error is `refused`, never `queued`. */
export function rpcManualPayoutQueue(db: RpcClient): ManualPayoutQueue {
  const supports = (source: ManualPayoutSource) =>
    source === "cancellation_fee" || (source === "auto_tip" && QUEUE_TAKES_TIP_PAYMENTS);
  return {
    supports,
    async queue(input) {
      if (!supports(input.source)) {
        return { outcome: "refused", reason: `queue_writer_does_not_take_${input.source}`, payoutId: null, recorded: false };
      }
      cents(input.amountCents, "amountCents", 1);
      cents(input.platformFeeCents, "platformFeeCents", 0);
      if (input.source === "auto_tip") return await recordTip(db, input);
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

/** The tips lane's recorder: marks the tip paid and queues its payout (idempotent). */
async function recordTip(db: RpcClient, input: QueueManualPayoutInput): Promise<QueueManualPayoutResult> {
  const c = input.tipCapture;
  if (!c) return { outcome: "refused", reason: "tip_capture_missing", payoutId: null, recorded: false };
  if (input.platformFeeCents !== 0) return { outcome: "refused", reason: "tip_pays_the_helpr_100_percent", payoutId: null, recorded: false };
  const { data, error } = await db.rpc("paypal_record_tip_capture", {
    p_provider_payment_id: input.providerPaymentId,
    p_order_id: c.providerOrderId,
    p_outcome: c.settled ? "completed" : "pending",
    p_capture_id: c.providerCaptureId,
    p_amount_cents: c.amountCents,
  });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    return { outcome: "refused", reason: missing ? "tip_recorder_not_deployed" : `rpc_error: ${error.message}`, payoutId: null, recorded: false };
  }
  return parseTipRecord(data);
}

/**
 * paypal_record_tip_capture's answer: { payout_id, payout_status, payout_reason }. Recorded only
 * when a payout row is named (queued, held, already_queued); anything else (not_settled,
 * no_payable_destination, payment_<status>) is retried by the owed-tip sweep.
 */
export function parseTipRecord(data: unknown): QueueManualPayoutResult {
  const d = (data ?? {}) as { payout_id?: unknown; payout_reason?: unknown; payout_status?: unknown };
  const payoutId = typeof d.payout_id === "string" ? d.payout_id : null;
  const reason = typeof d.payout_reason === "string" ? d.payout_reason : null;
  if (!payoutId) {
    return { outcome: reason === "no_payable_destination" ? "waiting_for_payee" : "refused", reason, payoutId: null, recorded: false };
  }
  const outcome: QueueOutcome = d.payout_status === "held" ? "held" : reason === "already_queued" ? "already_queued" : "queued";
  return { outcome, reason, payoutId, recorded: true };
}

const OUTCOMES: readonly QueueOutcome[] = ["queued", "already_queued", "waiting_for_payee", "held", "refused"];

/** Reads the RPC's jsonb answer. Anything unrecognised is `refused` (fail closed). */
export function parseQueueAnswer(data: unknown): QueueManualPayoutResult {
  const d = (data ?? {}) as { outcome?: unknown; reason?: unknown; payout_id?: unknown };
  const outcome = OUTCOMES.find((o) => o === d.outcome);
  if (!outcome) return { outcome: "refused", reason: `unrecognised_answer: ${JSON.stringify(data)?.slice(0, 120)}`, payoutId: null, recorded: false };
  const payoutId = typeof d.payout_id === "string" ? d.payout_id : null;
  // "Recorded" means a provider_payouts row holds the money: claimed by an id we can name.
  const recorded = (outcome === "queued" || outcome === "already_queued" || outcome === "held") && payoutId !== null;
  return { outcome, reason: typeof d.reason === "string" ? d.reason : null, payoutId, recorded };
}
