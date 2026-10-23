/**
 * A poster's cancelled job, paid through PayPal Checkout: the late-cancellation fee as a
 * PARTIAL REFUND (PayPal Plan A, phase 6; design ~/.lh-wt/paypal-design.md §3 "Cancellation
 * fee" and §6 phase 6).
 *
 * THE RULES ARE TODAY'S, UNCHANGED. Only the provider changes. Measured in the Stripe-era code
 * (void-cancelled-payments Part A, captured branch, 2026-10-23) and reused here by import, never
 * re-typed:
 *   - the fee: computeCancellationFee (_shared/cancellationFee.ts): 0% with no COMMITTED Helpr
 *     or 24 h+ out, 25% under 24 h, 50% under 2 h, of the budget, from the job's real start in
 *     America/Chicago and the recorded cancel time; an unfilled or ban-ended series visit and a
 *     Declutter seller-fault setup job owe none (same expression as the sweep);
 *   - what goes back: posterCancelSplit (_shared/posterCancelSplit.ts), the ONE split the cancel
 *     dialog's quote and the sweep share: captured less the processor's real fee (PayPal keeps
 *     its fee on a refund: MEASURED #02), less a first job's setup fee, less the fee owed, less
 *     the sales tax on what is kept, less what earlier refunds returned;
 *   - the Helpr's share of the fee: the job's own flat stamp (helprFlatFeeCents: PayPal jobs are
 *     stamped 8% + 70c by phase 5), rounded DOWN to whole dollars (roundPayoutDownCents, Q236);
 *     the platform keeps the rest of the fee.
 *
 * WHAT DIFFERS, BECAUSE PAYPAL IS NOT STRIPE:
 *   - PayPal Checkout captures at once (intent CAPTURE): there is never an uncaptured hold, so
 *     only the "captured" split applies. The poster's share goes back as ONE partial refund of
 *     the capture (POST /v2/payments/captures/{id}/refund, MEASURED #02).
 *   - The Helpr's share is not a Stripe transfer: it is queued for the owner to pay by hand
 *     (manual_paypal, the admin "Pay this Helpr" queue, phase 4) through ManualPayoutQueue.
 *   - ORDER: refund first, then queue the payout. The database refuses a refund while a payout
 *     of the same payment is queued (provider_refunds_guard), and refunds + payouts never exceed
 *     the payment (provider_payouts_guard). Both run again on every retry, so a crash between
 *     steps resumes: the refund row (UNIQUE idempotency key) is found and not re-sent, the queue
 *     answers already_queued.
 *
 * NOT ON PAYPAL YET (refused, the job stays in escrow and ops is told; nothing moves):
 *   a crew (group) job, a job a gift card helped pay, crew block fees. They keep their Stripe-era
 *   flows until a later phase ports them.
 *
 * Zero Deno imports: vitest imports this directly. The database is behind CancellationStore.
 */
import { cancellationFeePercent, computeCancellationFee, helperIsCommitted, hoursUntilJob, type CancellationFeeJob } from "../cancellationFee.ts";
import { posterCancelSplit } from "../posterCancelSplit.ts";
import { helprFlatFeeCents, isFlatFeeJob } from "../helprFlatFee.ts";
import { roundPayoutDownCents } from "../money.ts";
import { refundsSeriesVisitInFull } from "../seriesRefund.ts";
import type { ManualPayoutQueue, QueueOutcome } from "./manualPayoutQueue.ts";
import { ProviderApiError, type PaymentProvider, type ProviderEnv } from "./types.ts";

/** The job columns the plan reads (all from `jobs`, plus series_ban_cancelled_at). */
export interface PayPalCancelJob extends CancellationFeeJob {
  id: string;
  customer_id: string | null;
  customer_fee_amount?: number | string | null;
  poster_fee_flat_cents?: number | string | null;
  onboarding_fee_amount?: number | string | null;
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
  /** The tax inside the PayPal capture, as stamped on the job (dollars). */
  sales_tax_amount?: number | string | null;
  is_group_job?: boolean | null;
  parent_job_id?: string | null;
  recurrence_days?: unknown[] | null;
  series_ban_cancelled_at?: string | null;
}

export interface PayPalCancelPlanInput {
  job: PayPalCancelJob;
  /** A10: a Declutter seller's backing out cancelled this setup job. */
  sellerFault: boolean;
  /** provider_payments.amount_cents: what the capture took. */
  capturedCents: number;
  /** PayPal's own fee on the capture (seller_receivable_breakdown.paypal_fee). Kept, never refunded. */
  providerFeeCents: number;
  /** Live refunds of this payment made by OTHER paths (never this cancellation's own refund). */
  alreadyRefundedCents: number;
}

export type PayPalCancelPlan =
  | {
      kind: "plan";
      /** The late-cancellation fee, cents (0 / 25 / 50% of the budget). */
      feeCents: number;
      /** The fee tier, for logs and the poster's notice. */
      feePercent: 0 | 25 | 50;
      /** The partial refund to the poster now, cents (0 = send nothing). */
      refundCents: number;
      /** What the Helpr is paid out of the fee (whole dollars), cents. */
      helprPayoutCents: number;
      /** The part of the fee the platform keeps: its fee on it plus the rounded-off cents. */
      platformKeepsOfFeeCents: number;
      /** PayPal's fee kept from the poster (never absorbed: owner 2026-10-14). */
      providerFeeKeptCents: number;
      setupFeeKeptCents: number;
      taxKeptCents: number;
    }
  | { kind: "refuse"; reason: string };

function cents(n: number | string | null | undefined): number {
  const v = Math.round(Number(n ?? 0));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Dollars (as stored on jobs) to whole cents. */
function dollarCents(n: number | string | null | undefined): number {
  return cents(Math.round(Number(n ?? 0) * 100));
}

/**
 * How a poster's cancel splits a PayPal capture. Pure: the same inputs always give the same
 * answer, which is what lets a retried run re-derive (and check) what an earlier run sent.
 */
export function planPayPalCancellation(i: PayPalCancelPlanInput): PayPalCancelPlan {
  const job = i.job;
  if (job.is_group_job) return { kind: "refuse", reason: "crew_job_not_on_paypal" };
  if (!Number.isInteger(i.capturedCents) || i.capturedCents <= 0) return { kind: "refuse", reason: "no_capture" };
  if (!Number.isInteger(i.providerFeeCents) || i.providerFeeCents < 0) return { kind: "refuse", reason: "provider_fee_unknown" };
  // The same expression void-cancelled-payments prices a single job with (Part A).
  const feeDollars = i.sellerFault || refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job);
  const feeCents = Math.round(feeDollars * 100);
  const feePercent = (feeCents === 0
    ? 0
    : cancellationFeePercent(helperIsCommitted(job), hoursUntilJob(job.date_needed as string, job.cancelled_at, job.start_time))) as 0 | 25 | 50;
  // A fee is paid from the Helpr's flat stamp; a PayPal job without one was funded outside the
  // contract (phase 5 stamps every PayPal job). Refuse rather than guess a tier percent.
  if (feeCents > 0 && !isFlatFeeJob(job)) return { kind: "refuse", reason: "fee_model_unstamped" };
  const split = posterCancelSplit({
    job,
    sellerFault: i.sellerFault,
    cancellationFeeCents: feeCents,
    blockFeeCents: 0,
    charge: {
      state: "captured",
      capturedCents: i.capturedCents,
      actualFeeCents: i.providerFeeCents,
      alreadyRefundedCents: cents(i.alreadyRefundedCents),
      taxCents: dollarCents(job.sales_tax_amount),
    },
  });
  if (split.state !== "captured") return { kind: "refuse", reason: "split_not_captured" };
  // Stripe's sweep pays a fee the card cannot cover from a gift (Q1806); PayPal has no gift leg.
  if (!split.feesFitCard) return { kind: "refuse", reason: "fee_exceeds_payment" };
  const platformCutCents = feeCents > 0 ? helprFlatFeeCents(feeCents, job) : 0;
  const helprPayoutCents = Math.max(0, roundPayoutDownCents(feeCents - platformCutCents));
  return {
    kind: "plan",
    feeCents,
    feePercent,
    refundCents: split.backCents,
    helprPayoutCents,
    platformKeepsOfFeeCents: feeCents - helprPayoutCents,
    providerFeeKeptCents: split.split.feeKeptCents,
    setupFeeKeptCents: split.split.setupKeptCents,
    taxKeptCents: split.split.taxKeptCents,
  };
}

// ── The settlement: the plan, carried out once, resumable ───────────────────

export interface FundedPayment {
  id: string;
  env: ProviderEnv;
  amountCents: number;
  providerCaptureId: string;
  status: string;
}

export interface RefundRow {
  id: string;
  idempotencyKey: string;
  amountCents: number;
  status: "pending" | "completed" | "failed" | "cancelled";
  providerRefundId: string | null;
}

/** Everything the settlement reads or writes, so tests run on an in-memory twin. */
export interface CancellationStore {
  /** The job's funded PayPal payment (captured / partially_refunded / disputed / capture_pending), or null. */
  fundedPaymentForJob(jobId: string): Promise<FundedPayment | null>;
  refundsFor(paymentId: string): Promise<RefundRow[]>;
  /** Insert the pending refund row. Returns the row; on a UNIQUE key clash returns the existing row. */
  insertRefund(row: { paymentId: string; idempotencyKey: string; amountCents: number; reason: string }): Promise<RefundRow>;
  markRefund(id: string, patch: { status: RefundRow["status"]; providerRefundId?: string | null }): Promise<void>;
  setPaymentStatus(paymentId: string, status: "partially_refunded" | "refunded"): Promise<void>;
  /** Flip the job out of escrow (only while it still reads 'escrow'). False = zero rows matched. */
  settleJob(jobId: string, patch: { payment_status: "refunded"; cancellation_fee_status: "charged" | null }): Promise<boolean>;
}

export interface SettleDeps {
  store: CancellationStore;
  provider: Pick<PaymentProvider, "refund">;
  /** PayPal's fee on a capture, read from PayPal (GET /v2/payments/captures/{id}); null = unreadable. */
  readCaptureFeeCents(providerCaptureId: string): Promise<number | null>;
  queue: ManualPayoutQueue;
  /** The env this run's PayPal keys are for. A row of the other env is never touched. */
  env: ProviderEnv;
}

export type SettleOutcome =
  | { outcome: "settled"; plan: Extract<PayPalCancelPlan, { kind: "plan" }>; refundStatus: "none" | "completed" | "pending"; payoutId: string | null }
  | { outcome: "not_paypal" }
  /** Nothing moved, or only what is safe to resume; the job stays in escrow and the next run retries. */
  | { outcome: "retry"; reason: string }
  /** A person must look: nothing more moves for this job until they do. */
  | { outcome: "needs_review"; reason: string };

/** The cancellation's own refund key: one per payment, forever (provider_refunds.idempotency_key UNIQUE). */
export function cancelRefundKey(paymentId: string): string {
  return `lh:pp:${paymentId}:cancel-refund`;
}

const LIVE_REFUND = (r: RefundRow) => r.status !== "failed" && r.status !== "cancelled";

export async function settlePayPalCancellation(
  deps: SettleDeps,
  job: PayPalCancelJob,
  sellerFault: boolean,
): Promise<SettleOutcome> {
  const payment = await deps.store.fundedPaymentForJob(job.id);
  if (!payment) return { outcome: "not_paypal" };
  if (payment.env !== deps.env) return { outcome: "needs_review", reason: `env_mismatch: payment is ${payment.env}, keys are ${deps.env}` };
  // A dispute owns the money (execute-dispute-split, phase 7); unsettled PayPal money is not refunded.
  if (payment.status === "disputed") return { outcome: "retry", reason: "payment_disputed" };
  if (payment.status === "capture_pending") return { outcome: "retry", reason: "capture_not_settled" };
  if (payment.status !== "captured" && payment.status !== "partially_refunded") {
    return { outcome: "needs_review", reason: `payment_status_${payment.status}` };
  }

  const key = cancelRefundKey(payment.id);
  const refunds = await deps.store.refundsFor(payment.id);
  const own = refunds.find((r) => r.idempotencyKey === key) ?? null;
  if (own && !LIVE_REFUND(own)) return { outcome: "needs_review", reason: `cancel_refund_${own.status}: PayPal refused it; decide by hand` };
  const alreadyRefundedCents = refunds.filter((r) => r !== own && LIVE_REFUND(r)).reduce((s, r) => s + r.amountCents, 0);

  const providerFeeCents = await deps.readCaptureFeeCents(payment.providerCaptureId);
  if (providerFeeCents === null) return { outcome: "retry", reason: "provider_fee_unreadable" };

  const plan = planPayPalCancellation({ job, sellerFault, capturedCents: payment.amountCents, providerFeeCents, alreadyRefundedCents });
  if (plan.kind === "refuse") return { outcome: "needs_review", reason: plan.reason };
  // A resumed run re-derives the plan; it must match what the first run sent.
  if (own && own.amountCents !== plan.refundCents) {
    return { outcome: "needs_review", reason: `cancel_refund_amount_changed: sent ${own.amountCents}, plan now ${plan.refundCents}` };
  }

  // ── 1. The poster's share: one partial refund ──
  let refundStatus: "none" | "completed" | "pending" = "none";
  if (plan.refundCents > 0) {
    const row = own ?? await deps.store.insertRefund({ paymentId: payment.id, idempotencyKey: key, amountCents: plan.refundCents, reason: "poster_cancel" });
    if (row.status === "completed") {
      refundStatus = "completed";
    } else if (row.providerRefundId) {
      // PayPal has it (PENDING at PayPal); its webhook reconciles completion. Nothing to resend.
      refundStatus = "pending";
    } else {
      try {
        const r = await deps.provider.refund({
          idempotencyKey: `lh:refund:${row.id}`,
          providerCaptureId: payment.providerCaptureId,
          amountCents: row.amountCents,
          note: "Your cancelled Louisiana Helpr job",
        });
        if (r.amountCents !== row.amountCents) {
          await deps.store.markRefund(row.id, { status: r.settled ? "completed" : "pending", providerRefundId: r.providerRefundId });
          return { outcome: "needs_review", reason: `refund_amount_mismatch: asked ${row.amountCents}, PayPal refunded ${r.amountCents}` };
        }
        await deps.store.markRefund(row.id, { status: r.settled ? "completed" : "pending", providerRefundId: r.providerRefundId });
        refundStatus = r.settled ? "completed" : "pending";
      } catch (e) {
        if (e instanceof ProviderApiError && !e.retryable) {
          // PayPal answered and refused (e.g. 422 REFUND_AMOUNT_EXCEEDED): no money moved.
          await deps.store.markRefund(row.id, { status: "failed" });
          return { outcome: "needs_review", reason: `refund_refused: ${e.issue ?? e.httpStatus} ${e.message}`.slice(0, 300) };
        }
        // Unknown outcome: the row stays pending with no PayPal id; the next run replays the SAME key.
        return { outcome: "retry", reason: `refund_outcome_unknown: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
      }
    }
    const refundedNow = alreadyRefundedCents + row.amountCents;
    await deps.store.setPaymentStatus(payment.id, refundedNow >= payment.amountCents ? "refunded" : "partially_refunded");
  }

  // ── 2. The Helpr's share of the fee: queued for the owner to pay by hand ──
  let payoutId: string | null = null;
  if (plan.helprPayoutCents > 0) {
    if (!job.helper_id) return { outcome: "needs_review", reason: "fee_without_helper" };
    const q = await deps.queue.queue({
      jobId: job.id,
      helperId: job.helper_id,
      amountCents: plan.helprPayoutCents,
      platformFeeCents: plan.platformKeepsOfFeeCents,
      source: "cancellation_fee",
      providerPaymentId: payment.id,
    });
    if (!q.recorded) {
      // The refund (if any) is out and recorded; the job stays in escrow so this step is retried.
      const why: QueueOutcome = q.outcome;
      return { outcome: "retry", reason: `fee_payout_${why}${q.reason ? `: ${q.reason}` : ""}` };
    }
    payoutId = q.payoutId;
  }

  // ── 3. The job leaves escrow, the same patch the Stripe sweep writes on a captured refund ──
  const flipped = await deps.store.settleJob(job.id, {
    payment_status: "refunded",
    cancellation_fee_status: plan.feeCents > 0 ? "charged" : null,
  });
  if (!flipped) return { outcome: "needs_review", reason: "settled_not_flipped: money moved but jobs.payment_status did not leave 'escrow'" };
  return { outcome: "settled", plan, refundStatus, payoutId };
}

// ── The supabase twin of CancellationStore ──────────────────────────────────

/** The supabase-js surface this needs. `any` because the generated types do not know phase 6's columns. */
// deno-lint-ignore no-explicit-any
type Db = any;

const FUNDED = ["captured", "partially_refunded", "disputed", "capture_pending"];

export function supabaseCancellationStore(db: Db): CancellationStore {
  const must = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  const toRefund = (r: Record<string, unknown>): RefundRow => ({
    id: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    amountCents: Number(r.amount_cents),
    status: r.status as RefundRow["status"],
    providerRefundId: (r.provider_refund_id as string | null) ?? null,
  });
  return {
    async fundedPaymentForJob(jobId) {
      // Interpolated into a PostgREST filter below: only ever a uuid.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new Error(`not a job id: ${jobId}`);
      // A job's own payment, or the repeat-visit payment that funded this visit job (funds_job_id).
      const { data, error } = await db
        .from("provider_payments")
        .select("id, env, amount_cents, provider_capture_id, status, subject_kind, subject_id, funds_job_id")
        .or(`and(subject_kind.eq.job,subject_id.eq.${jobId}),funds_job_id.eq.${jobId}`)
        .in("status", FUNDED);
      must("provider_payments read", error);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return null;
      if (rows.length > 1) throw new Error(`job ${jobId} has ${rows.length} funded PayPal payments`);
      const r = rows[0];
      return { id: String(r.id), env: r.env as ProviderEnv, amountCents: Number(r.amount_cents), providerCaptureId: String(r.provider_capture_id), status: String(r.status) };
    },
    async refundsFor(paymentId) {
      const { data, error } = await db.from("provider_refunds").select("id, idempotency_key, amount_cents, status, provider_refund_id").eq("provider_payment_id", paymentId);
      must("provider_refunds read", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(toRefund);
    },
    async insertRefund(row) {
      const { data, error } = await db
        .from("provider_refunds")
        .insert({ provider_payment_id: row.paymentId, idempotency_key: row.idempotencyKey, amount_cents: row.amountCents, reason: row.reason, status: "pending" })
        .select("id, idempotency_key, amount_cents, status, provider_refund_id")
        .single();
      if (error?.code === "23505") {
        const { data: again, error: againErr } = await db.from("provider_refunds").select("id, idempotency_key, amount_cents, status, provider_refund_id").eq("idempotency_key", row.idempotencyKey).single();
        must("provider_refunds re-read", againErr);
        return toRefund(again);
      }
      must("provider_refunds insert", error);
      return toRefund(data);
    },
    async markRefund(id, patch) {
      const { data, error } = await db
        .from("provider_refunds")
        .update({ status: patch.status, ...(patch.providerRefundId ? { provider_refund_id: patch.providerRefundId } : {}), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      must("provider_refunds update", error);
      if (!data || data.length === 0) throw new Error(`provider_refunds update matched 0 rows (${id})`);
    },
    async setPaymentStatus(paymentId, status) {
      const { data, error } = await db
        .from("provider_payments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", paymentId)
        .in("status", ["captured", "partially_refunded"])
        .select("id");
      must("provider_payments status update", error);
      // Zero rows: already 'refunded' (a resumed run) is fine; anything else the next read sees.
      void data;
    },
    async settleJob(jobId, patch) {
      const { data, error } = await db.from("jobs").update(patch).eq("id", jobId).eq("payment_status", "escrow").select("id");
      if (error) return false;
      return !!data && data.length > 0;
    },
  };
}
