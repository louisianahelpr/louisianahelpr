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
import type { ManualPayoutQueue, QueueOutcome } from "./phase6PayoutDoors.ts";
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
      feePercent: number;
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
      /** A ban-ended visit owes no fee; what the booked Helpr would otherwise be owed (Q738: told to admins). */
      withheldForBanCents: number;
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
  // A10 seller fault: today the card fee becomes the Declutter seller's debt
  // (declutter_setup_job_fee_debt). Declutter is not on PayPal; refuse rather than absorb it.
  if (i.sellerFault) return { kind: "refuse", reason: "seller_fault_not_on_paypal" };
  // The same expression void-cancelled-payments prices a single job with (Part A).
  const feeDollars = i.sellerFault || refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job);
  const feeCents = Math.round(feeDollars * 100);
  const feePercent = (feeCents === 0
    ? 0
    : cancellationFeePercent(helperIsCommitted(job), hoursUntilJob(job.date_needed as string, job.cancelled_at, job.start_time)));
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
  // The Stripe sweep's guard: earlier refunds already returned more than this cancel may give back
  // (refunded > ceiling + 1c). Paying the Helpr's fee then would come out of money already gone.
  if (cents(i.alreadyRefundedCents) > split.split.ceilingCents + 1) return { kind: "refuse", reason: "refunded_past_kept" };
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
    withheldForBanCents: job.series_ban_cancelled_at && job.helper_id ? Math.round(computeCancellationFee(job) * 100) : 0,
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
  createdAtMs: number;
}

/**
 * The refund door: phase 5's refundProviderPayment (_shared/payments/providerRefunds.ts), the ONE
 * way a PayPal payment is refunded (claim the provider_refunds row, ask PayPal with the row's key,
 * record). The settlement depends on this shape only. Until phase 5 is on main the cron wires
 * `interimCancelRefundDoor` below (TEMPORARY, same key, same outcome shape); after it, one line in
 * void-cancelled-payments/paypalCancel.ts swaps it for refundProviderPayment.
 */
export type CancelRefundOutcome =
  | { kind: "refunded"; refundRowId: string; providerRefundId: string; settled: boolean; amountCents: number; askedCents: number; amountMismatch: boolean; replay: boolean; paymentStatus: string | null }
  | { kind: "refused"; code: string; message: string; refundRowId: string | null }
  | { kind: "retry"; message: string; refundRowId: string | null }
  | { kind: "recorded_late"; message: string; refundRowId: string; providerRefundId: string; amountCents: number };

export interface CancelRefundRequest {
  paymentId: string;
  idempotencyKey: string;
  amountCents: number;
  reason: string;
  noteToPayer?: string;
  /** The most all live refunds of the payment may total (paid less what is kept). */
  maxTotalCents?: number;
}

export interface CancelRefundDoor {
  refund(req: CancelRefundRequest): Promise<CancelRefundOutcome>;
}

/** Everything the settlement reads or writes, so tests run on an in-memory twin. */
export interface CancellationStore {
  /** The job's funded PayPal payment (captured / partially_refunded / disputed / capture_pending), or null. */
  fundedPaymentForJob(jobId: string): Promise<FundedPayment | null>;
  refundsFor(paymentId: string): Promise<RefundRow[]>;
  /**
   * Flip the job out of escrow (cancelled + 'escrow' -> 'refunded'): paypal_settle_cancelled_job,
   * which sets phase 3's app.paypal_money_write. False = zero rows matched; throws on an error.
   */
  settleJob(jobId: string, patch: { payment_status: "refunded"; cancellation_fee_status: "charged" | null }): Promise<boolean>;
}

export interface SettleDeps {
  store: CancellationStore;
  refunds: CancelRefundDoor;
  /** PayPal's fee on a capture, read from PayPal (GET /v2/payments/captures/{id}); null = unreadable. */
  readCaptureFeeCents(providerCaptureId: string): Promise<number | null>;
  queue: ManualPayoutQueue;
  /** The env this run's PayPal keys are for. A row of the other env is never touched. */
  env: ProviderEnv;
}

export type SettleOutcome =
  | { outcome: "settled"; plan: Extract<PayPalCancelPlan, { kind: "plan" }>; refundStatus: "none" | "completed" | "pending"; providerRefundId: string | null; payoutId: string | null }
  | { outcome: "not_paypal" }
  /** Nothing moved, or only what is safe to resume; the job stays in escrow and the next run retries. */
  | { outcome: "retry"; reason: string }
  /** A person must look: nothing more moves for this job until they do. */
  | { outcome: "needs_review"; reason: string };

/**
 * The cancellation's refund key: phase 5's business key (provider_refunds.idempotency_key UNIQUE).
 * After a refund PayPal refused, the next offer is a NEW attempt: `:a<n+1>` (phase 5's
 * cancelRefundKey(job, earlierAttempts)), at most CANCEL_REFUND_MAX_ATTEMPTS in all.
 */
export function cancelRefundKey(jobId: string, earlierAttempts = 0): string {
  return earlierAttempts > 0 ? `lh:job:${jobId}:refund:cancel:a${earlierAttempts + 1}` : `lh:job:${jobId}:refund:cancel`;
}

export const CANCEL_REFUND_MAX_ATTEMPTS = 3;

function isCancelKey(jobId: string, key: string): boolean {
  return key === `lh:job:${jobId}:refund:cancel` || new RegExp(`^lh:job:${jobId}:refund:cancel:a\\d+$`).test(key);
}

const LIVE_REFUND = (r: RefundRow) => r.status !== "failed" && r.status !== "cancelled";

/**
 * How long an unanswered refund may be re-sent with the same PayPal-Request-Id (the same bound
 * as a saved charge, PAYPAL_REPLAY_WINDOW_MS: PayPal's request-id memory is hours). Past it a
 * person checks PayPal before anything is re-sent.
 */
export const REFUND_REPLAY_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function settlePayPalCancellation(
  deps: SettleDeps,
  job: PayPalCancelJob,
  sellerFault: boolean,
  now: () => number = Date.now,
): Promise<SettleOutcome> {
  const payment = await deps.store.fundedPaymentForJob(job.id);
  if (!payment) return { outcome: "not_paypal" };
  if (payment.env !== deps.env) return { outcome: "needs_review", reason: `env_mismatch: payment is ${payment.env}, keys are ${deps.env}` };
  // A dispute owns the money (execute-dispute-split, phase 7); unsettled PayPal money is not refunded.
  if (payment.status === "disputed") return { outcome: "retry", reason: "payment_disputed" };
  if (payment.status === "capture_pending") return { outcome: "retry", reason: "capture_not_settled" };
  if (payment.status !== "captured" && payment.status !== "partially_refunded" && payment.status !== "refunded") {
    return { outcome: "needs_review", reason: `payment_status_${payment.status}` };
  }

  const refunds = await deps.store.refundsFor(payment.id);
  const cancelRows = refunds.filter((r) => isCancelKey(job.id, r.idempotencyKey));
  // The live cancel refund, if any (there is at most one: a new attempt is made only after a dead one).
  const own = cancelRows.find(LIVE_REFUND) ?? null;
  const deadAttempts = cancelRows.filter((r) => !LIVE_REFUND(r)).length;
  if (!own && deadAttempts >= CANCEL_REFUND_MAX_ATTEMPTS) {
    return { outcome: "needs_review", reason: `cancel_refund_refused_${deadAttempts}_times: PayPal refused every offer; refund the poster by hand` };
  }
  const key = own ? own.idempotencyKey : cancelRefundKey(job.id, deadAttempts);
  const alreadyRefundedCents = refunds.filter((r) => r !== own && LIVE_REFUND(r) && !isCancelKey(job.id, r.idempotencyKey)).reduce((s, r) => s + r.amountCents, 0);

  const providerFeeCents = await deps.readCaptureFeeCents(payment.providerCaptureId);
  if (providerFeeCents === null) return { outcome: "retry", reason: "provider_fee_unreadable" };

  const plan = planPayPalCancellation({ job, sellerFault, capturedCents: payment.amountCents, providerFeeCents, alreadyRefundedCents });
  if (plan.kind === "refuse") return { outcome: "needs_review", reason: plan.reason };
  // A resumed run re-derives the plan; it must match what was sent (or what PayPal recorded).
  if (own && own.amountCents !== plan.refundCents) {
    return { outcome: "needs_review", reason: `cancel_refund_amount_changed: recorded ${own.amountCents}, plan now ${plan.refundCents}` };
  }

  // ── 1. The poster's share: one partial refund, through the refund door ──
  let refundStatus: "none" | "completed" | "pending" = "none";
  let providerRefundId: string | null = own?.providerRefundId ?? null;
  if (plan.refundCents > 0) {
    if (own && own.status === "pending" && !own.providerRefundId && now() - own.createdAtMs > REFUND_REPLAY_WINDOW_MS) {
      return { outcome: "needs_review", reason: `refund_unanswered_past_replay_window: check PayPal for ${key} on capture ${payment.providerCaptureId} before re-sending` };
    }
    const r = await deps.refunds.refund({
      paymentId: payment.id,
      idempotencyKey: key,
      amountCents: plan.refundCents,
      reason: "poster_cancel",
      noteToPayer: "Your cancelled Louisiana Helpr job",
      // Every live refund of this payment together: never past what this cancel may give back.
      maxTotalCents: alreadyRefundedCents + plan.refundCents,
    });
    if (r.kind === "retry") return { outcome: "retry", reason: `refund_outcome_unknown: ${r.message}`.slice(0, 300) };
    if (r.kind === "refused") return { outcome: "needs_review", reason: `refund_refused: ${r.code}: ${r.message}`.slice(0, 300) };
    if (r.kind === "recorded_late") return { outcome: "needs_review", reason: `refund_recorded_late: PayPal refunded ${r.amountCents} (${r.providerRefundId}) but the ledger did not take it: ${r.message}`.slice(0, 300) };
    if (r.amountMismatch || r.amountCents !== plan.refundCents) {
      return { outcome: "needs_review", reason: `refund_amount_mismatch: asked ${plan.refundCents}, PayPal refunded ${r.amountCents}` };
    }
    providerRefundId = r.providerRefundId;
    refundStatus = r.settled ? "completed" : "pending";
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
  return { outcome: "settled", plan, refundStatus, providerRefundId, payoutId };
}

// ── The supabase twin of CancellationStore ──────────────────────────────────

/** The supabase-js surface this needs. `any` because the generated types do not know phase 6's columns. */
// deno-lint-ignore no-explicit-any
type Db = any;

const FUNDED = ["captured", "partially_refunded", "refunded", "disputed", "capture_pending"];
const REFUND_COLS = "id, idempotency_key, amount_cents, status, provider_refund_id, created_at";

function must(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}
function toRefund(r: Record<string, unknown>): RefundRow {
  return {
    id: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    amountCents: Number(r.amount_cents),
    status: r.status as RefundRow["status"],
    providerRefundId: (r.provider_refund_id as string | null) ?? null,
    createdAtMs: Date.parse(String(r.created_at)),
  };
}

export function supabaseCancellationStore(db: Db): CancellationStore {
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
      const { data, error } = await db.from("provider_refunds").select(REFUND_COLS).eq("provider_payment_id", paymentId);
      must("provider_refunds read", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(toRefund);
    },
    async settleJob(jobId, patch) {
      const { data, error } = await db.rpc("paypal_settle_cancelled_job", { p_job_id: jobId, p_cancellation_fee_status: patch.cancellation_fee_status });
      // An error is not "zero rows": throw with it, so the page names the real cause.
      if (error) throw new Error(`paypal_settle_cancelled_job failed: ${error.message}`);
      return data === true;
    },
  };
}

/**
 * TEMPORARY refund door (until phase 5's refundProviderPayment is on main; lead 2026-10-23: the
 * phases land in order and this branch lands last). The same order as phase 5's door: claim the
 * provider_refunds row first (UNIQUE key, phase 1's guard: never past a queued payout or the
 * payment), ask PayPal with PayPal-Request-Id = the key, record. Same key, same outcome shape.
 * It enforces `maxTotalCents` before the claim; phase 5's paypal_refund_claim does so under the
 * payment lock. Swap it out in one line in void-cancelled-payments/paypalCancel.ts.
 */
export function interimCancelRefundDoor(db: Db, provider: Pick<PaymentProvider, "refund">): CancelRefundDoor {
  return {
    async refund(req) {
      if (req.maxTotalCents !== undefined) {
        const { data: live, error: lErr } = await db.from("provider_refunds").select("amount_cents, status, idempotency_key").eq("provider_payment_id", req.paymentId);
        if (lErr) return { kind: "retry", message: `refunds read: ${lErr.message}`, refundRowId: null };
        const others = ((live ?? []) as Array<{ amount_cents: number; status: string; idempotency_key: string }>)
          .filter((x) => x.idempotency_key !== req.idempotencyKey && x.status !== "failed" && x.status !== "cancelled")
          .reduce((s, x) => s + Number(x.amount_cents), 0);
        if (others + req.amountCents > req.maxTotalCents) {
          return { kind: "refused", code: "refund_exceeds_refundable", message: `${others} already refunded + ${req.amountCents} > ${req.maxTotalCents}`, refundRowId: null };
        }
      }
      // CLAIM
      const ins = await db
        .from("provider_refunds")
        .insert({ provider_payment_id: req.paymentId, idempotency_key: req.idempotencyKey, amount_cents: req.amountCents, reason: req.reason, status: "pending" })
        .select(REFUND_COLS)
        .single();
      let row: RefundRow;
      if (ins.error?.code === "23505") {
        const again = await db.from("provider_refunds").select(REFUND_COLS).eq("idempotency_key", req.idempotencyKey).single();
        if (again.error) return { kind: "retry", message: `claim re-read: ${again.error.message}`, refundRowId: null };
        row = toRefund(again.data);
        if (row.amountCents !== req.amountCents) return { kind: "refused", code: "refund_key_reused", message: `key holds ${row.amountCents}, asked ${req.amountCents}`, refundRowId: row.id };
      } else if (ins.error) {
        const code = ["refund_after_payout_queued", "refund_exceeds_payment", "refund_needs_captured_payment"].find((c) => ins.error.message.includes(c));
        return code ? { kind: "refused", code, message: ins.error.message, refundRowId: null } : { kind: "retry", message: `claim failed: ${ins.error.message}`, refundRowId: null };
      } else {
        row = toRefund(ins.data);
      }
      if (row.status === "completed" && row.providerRefundId) {
        return { kind: "refunded", refundRowId: row.id, providerRefundId: row.providerRefundId, settled: true, amountCents: row.amountCents, askedCents: req.amountCents, amountMismatch: row.amountCents !== req.amountCents, replay: true, paymentStatus: null };
      }
      if (row.status === "failed" || row.status === "cancelled") return { kind: "refused", code: "earlier_attempt_failed", message: `this refund already ${row.status}`, refundRowId: row.id };
      const { data: pay, error: payErr } = await db.from("provider_payments").select("provider_capture_id, amount_cents").eq("id", req.paymentId).single();
      if (payErr || !pay?.provider_capture_id) return { kind: "retry", message: `capture read: ${payErr?.message ?? "no capture"}`, refundRowId: row.id };
      // ASK
      let paid;
      try {
        paid = await provider.refund({ idempotencyKey: req.idempotencyKey, providerCaptureId: String(pay.provider_capture_id), amountCents: req.amountCents, note: req.noteToPayer, invoiceId: row.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof ProviderApiError && ([400, 404, 422].includes(e.httpStatus) || e.errorName === "REFUND_NOT_SUCCESSFUL")) {
          const { error: mErr } = await db.from("provider_refunds").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", row.id);
          if (mErr) return { kind: "retry", message: `PayPal refused and the row could not be marked failed: ${mErr.message}`, refundRowId: row.id };
          return { kind: "refused", code: "provider_refused", message: `${e.issue ?? e.httpStatus}: ${msg}`, refundRowId: row.id };
        }
        return { kind: "retry", message: msg, refundRowId: row.id };
      }
      // RECORD (PayPal's own amount, so a mismatch is durable)
      const { data: rec, error: rErr } = await db
        .from("provider_refunds")
        .update({ status: paid.settled ? "completed" : "pending", provider_refund_id: paid.providerRefundId, amount_cents: paid.amountCents, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .select("id");
      if (rErr || !rec || rec.length === 0) {
        return { kind: "recorded_late", message: rErr?.message ?? "zero rows", refundRowId: row.id, providerRefundId: paid.providerRefundId, amountCents: paid.amountCents };
      }
      const { data: all, error: aErr } = await db.from("provider_refunds").select("amount_cents, status").eq("provider_payment_id", req.paymentId);
      if (!aErr) {
        const total = ((all ?? []) as Array<{ amount_cents: number; status: string }>).filter((x) => x.status !== "failed" && x.status !== "cancelled").reduce((s, x) => s + Number(x.amount_cents), 0);
        await db.from("provider_payments").update({ status: total >= Number(pay.amount_cents) ? "refunded" : "partially_refunded", updated_at: new Date().toISOString() }).eq("id", req.paymentId).in("status", ["captured", "partially_refunded"]);
      }
      return { kind: "refunded", refundRowId: row.id, providerRefundId: paid.providerRefundId, settled: paid.settled, amountCents: paid.amountCents, askedCents: req.amountCents, amountMismatch: paid.amountCents !== req.amountCents, replay: false, paymentStatus: null };
    },
  };
}
