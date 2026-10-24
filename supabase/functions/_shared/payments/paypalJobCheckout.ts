/**
 * A job paid through PayPal Checkout and held (PayPal Plan A, phase 3; design
 * ~/.lh-wt/paypal-design.md §6 row 3; migration 20261023232151_paypal_job_checkout).
 *
 * The state machine between our provider_payments row and PayPal's order:
 *
 *   openJobCheckout   create-payment `escrow`: reuse the job's open order when it is
 *                     still the same price, else retire it and open a new one; return
 *                     PayPal's approve link (or "already paid").
 *   settleJobPayment  capture an approved order and record it. Called from the return
 *                     page (create-payment `paypal_capture`), from the webhook
 *                     (CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.*) and from a re-mint.
 *                     It always RE-READS the order from PayPal and acts on that state,
 *                     never on an event body or on the order events arrive in. Every
 *                     caller uses the same capture key, so all of them together make
 *                     exactly one capture.
 *
 * The database decides; this module only asks PayPal. Every decision that must
 * hold under concurrency (one open order per job, capture only a claimed order
 * whose job still has that price, fund the job once) is a conditional write in
 * one SECURITY DEFINER RPC (service role only). The DB access is `rpc()` only,
 * so the same code runs on PGlite in the proofs.
 *
 * Money in only. Refunds of an orphaned capture are phase 5's: every outcome
 * that leaves PayPal holding money the job does not is returned as a
 * `money_at_risk` outcome for the caller to alert on, never swallowed.
 */
import { ProviderApiError, type CaptureResult, type OrderState, type PaymentProvider, type ProviderEnv } from "./types.ts";

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface JobCheckoutCtx {
  db: RpcClient;
  provider: PaymentProvider;
  /** From PAYPAL_ENV (the client refuses live while PAYPAL_LIVE_ALLOWED is false). */
  env: ProviderEnv;
  log?: (msg: string) => void;
}

/** A provider_payments row as the RPCs return it (to_jsonb). */
export interface JobPaymentRow {
  id: string;
  subject_id: string;
  payer_id: string | null;
  env: ProviderEnv;
  status: string;
  provider_order_id: string;
  provider_capture_id: string | null;
  amount_cents: number;
  idempotency_key: string;
  breakdown: JobOrderBreakdown | null;
  /** Why a row was voided or failed; `orphan:<why>` = a capture that funds nothing (money PayPal holds). */
  status_reason?: string | null;
}

/**
 * What an order was priced from. The price facts are pinned in the database
 * (paypal_job_price_matches): an order is captured only while the job still has them.
 */
export interface JobOrderBreakdown {
  budget: number;
  urgent_fee: number;
  is_urgent: boolean;
  category: string | null;
  helpers_needed: number | null;
  recurrence_days: number[] | null;
  /** budget + urgent bonus, in cents. */
  job_price_cents: number;
  onboarding_fee_cents: number;
  /** job price + onboarding fee: PayPal's item_total. */
  item_cents: number;
  tax_cents: number;
  taxable_base_cents: number;
  helper_fee_percent: number;
  helper_fee_flat_cents: number;
}

export type SettleOutcome =
  | { kind: "funded"; fresh: boolean; onboardingFeeDuplicate?: boolean }
  | { kind: "pending" }
  | { kind: "not_approved"; approveUrl: string | null }
  | { kind: "declined"; reason: string }
  | { kind: "retired"; reason: string }
  | { kind: "refused"; reason: string }
  | { kind: "money_at_risk"; reason: string; captureId: string | null };

const FUNDED_STATUSES = new Set(["captured", "partially_refunded", "refunded", "disputed", "reversed"]);

/** The one capture key per order: the return page, the webhook and a re-mint all send it. */
export function captureKey(jobId: string, orderId: string): string {
  return `lh:job:${jobId}:capture:${orderId}`;
}

/** The order key names the job, the amount (PayPal replays the original order for a reused key) and the attempt. */
function orderKey(jobId: string, amountCents: number, attempt: number): string {
  return `lh:job:${jobId}:checkout:amt${amountCents}:a${attempt}`;
}

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const e = new Error(`${fn}: ${error.message}`) as Error & { code?: string; dbMessage?: string };
    e.code = error.code;
    e.dbMessage = error.message;
    throw e;
  }
  return data as T;
}

function sameEnv(ctx: JobCheckoutCtx, row: JobPaymentRow): void {
  // A sandbox row is never acted on under a live key (or the reverse): crossed configuration.
  if (row.env !== ctx.env) throw new Error(`paypal_env_mismatch: payment ${row.id} is ${row.env}, this function runs ${ctx.env}`);
}

async function record(ctx: JobCheckoutCtx, row: JobPaymentRow, cap: CaptureResult): Promise<SettleOutcome> {
  if (cap.providerOrderId !== row.provider_order_id) {
    return { kind: "money_at_risk", reason: `capture ${cap.providerCaptureId} belongs to order ${cap.providerOrderId}, not ${row.provider_order_id}`, captureId: cap.providerCaptureId };
  }
  const out = await call<{ outcome: string; onboarding_fee_duplicate?: boolean; status?: string }>(ctx.db, "paypal_job_capture_record", {
    p_payment_id: row.id,
    p_capture_id: cap.providerCaptureId,
    p_amount_cents: cap.amountCents,
    p_settled: cap.settled,
    p_fee_cents: cap.feeCents,
  });
  switch (out?.outcome) {
    case "funded":
      return { kind: "funded", fresh: true, onboardingFeeDuplicate: out.onboarding_fee_duplicate === true };
    case "already_funded":
      return { kind: "funded", fresh: false };
    case "pending":
      return { kind: "pending" };
    default:
      // orphan / job_moved / amount_mismatch / capture_id_mismatch: PayPal holds money the job does not.
      return { kind: "money_at_risk", reason: `${out?.outcome ?? "no outcome"}${out?.status ? ` (${out.status})` : ""}`, captureId: cap.providerCaptureId };
  }
}

async function failed(ctx: JobCheckoutCtx, row: JobPaymentRow, reason: string): Promise<SettleOutcome> {
  const marked = await call<boolean>(ctx.db, "paypal_job_capture_failed", { p_payment_id: row.id, p_reason: reason });
  // false = the row had already moved on (another caller recorded it): say so, never "declined".
  return marked === true ? { kind: "declined", reason } : { kind: "refused", reason: `row_moved (${reason})` };
}

/** A capture PayPal reports as refunded that the app never recorded as funding the job. */
const REFUNDED_ISSUES = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);

/** PayPal's own words for "this payer's money was refused": the order can never be captured as it is. */
const DECLINE_ISSUES = new Set([
  "INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY",
  "CAPTURE_NOT_SUCCESSFUL", "DECLINED", "DENIED", "FAILED", "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED",
]);

function isDecline(e: unknown): e is ProviderApiError {
  return e instanceof ProviderApiError && !e.retryable && !!e.issue && DECLINE_ISSUES.has(e.issue);
}

/**
 * Bring one payment row up to date with PayPal: capture it if it is approved, record a
 * capture PayPal already made, or say why nothing can happen yet. Idempotent: any number
 * of calls, from any mix of callers, capture at most once.
 */
export async function settleJobPayment(ctx: JobCheckoutCtx, row: JobPaymentRow): Promise<SettleOutcome> {
  sameEnv(ctx, row);
  if (FUNDED_STATUSES.has(row.status)) return { kind: "funded", fresh: false };
  // An orphan: PayPal holds a capture that funds nothing. Reported on EVERY read until it is settled by hand.
  if (row.status_reason?.startsWith("orphan:")) {
    return { kind: "money_at_risk", reason: row.status_reason, captureId: row.provider_capture_id };
  }
  if (row.status === "voided" || row.status === "failed") {
    // Retired here, but a capture that was in flight when the row was retired may still have landed:
    // re-read the order, and a COMPLETED one is recorded (as an orphan) and reported, never closed quietly.
    let dead: OrderState | null = null;
    try {
      dead = await ctx.provider.getOrder(row.provider_order_id);
    } catch (e) {
      // A declined capture, or one refunded at PayPal (reported when its row was retired): nothing more to do.
      if (!isDecline(e) && !(e instanceof ProviderApiError && e.issue && REFUNDED_ISSUES.has(e.issue))) throw e;
    }
    if (dead?.status === "COMPLETED" && dead.capture) return await record(ctx, row, dead.capture);
    return row.status === "voided" ? { kind: "retired", reason: "voided" } : { kind: "declined", reason: "failed" };
  }

  let order: OrderState;
  try {
    order = await ctx.provider.getOrder(row.provider_order_id);
  } catch (e) {
    // A COMPLETED order whose capture was DECLINED reads as a typed decline.
    if (isDecline(e)) return await failed(ctx, row, e.issue ?? "declined");
    if (e instanceof ProviderApiError && e.issue && REFUNDED_ISSUES.has(e.issue)) {
      // Captured and refunded at PayPal (by hand) while the app never recorded it: retire the row so the
      // job can be paid again, and report it: PayPal and the app disagree about this job's money.
      await failed(ctx, row, `capture ${e.issue.toLowerCase()} at PayPal`);
      return { kind: "money_at_risk", reason: `capture ${e.issue.toLowerCase()} at PayPal before it was recorded`, captureId: row.provider_capture_id };
    }
    throw e;
  }

  if (order.status === "COMPLETED" && order.capture) {
    return await record(ctx, row, order.capture);
  }
  if (order.status === "GONE" || order.status === "VOIDED") {
    if (row.provider_capture_id) {
      // A capture exists (pending) yet PayPal no longer shows its order: never assume nothing was taken.
      return { kind: "money_at_risk", reason: `order ${order.status.toLowerCase()} at PayPal with capture ${row.provider_capture_id} on record`, captureId: row.provider_capture_id };
    }
    if (row.status === "created") {
      const voided = await call<boolean>(ctx.db, "paypal_job_order_void", { p_payment_id: row.id, p_reason: `order ${order.status.toLowerCase()} at PayPal` });
      return voided === true ? { kind: "retired", reason: `order_${order.status.toLowerCase()}` } : { kind: "refused", reason: "row_moved" };
    }
    // Claimed, never captured (no capture id), and PayPal no longer has the order: nothing was taken.
    return await failed(ctx, row, `order ${order.status.toLowerCase()} at PayPal after approval`);
  }
  if (row.status === "capture_pending") {
    // PayPal has not finished (an eCheck clearing). The PAYMENT.CAPTURE.COMPLETED webhook re-runs this.
    return { kind: "pending" };
  }
  if (order.status !== "APPROVED") {
    // CREATED / PAYER_ACTION_REQUIRED / SAVED: the payer has not approved yet. Nothing to do.
    return { kind: "not_approved", approveUrl: order.approveUrl };
  }
  if (order.amountCents !== null && order.amountCents !== Number(row.amount_cents)) {
    // Never capture an order whose total is not the row's (the claim pins the job's price to the row).
    return { kind: "refused", reason: `order total ${order.amountCents} is not ${row.amount_cents}` };
  }

  const claim = await call<{ ok: boolean; reason: string }>(ctx.db, "paypal_job_capture_claim", { p_payment_id: row.id });
  if (!claim?.ok) {
    if (claim?.reason && FUNDED_STATUSES.has(claim.reason)) return { kind: "funded", fresh: false };
    if (claim?.reason === "capture_pending") return { kind: "pending" };
    return { kind: claim?.reason === "feature_disabled" ? "refused" : "retired", reason: claim?.reason ?? "claim_refused" };
  }

  let cap: CaptureResult;
  try {
    cap = await ctx.provider.capture(captureKey(row.subject_id, row.provider_order_id), row.provider_order_id);
  } catch (e) {
    if (e instanceof ProviderApiError && e.issue === "ORDER_ALREADY_CAPTURED") {
      // Captured under another request id (PayPal's key cache expired): read the capture it made.
      const again = await ctx.provider.getOrder(row.provider_order_id);
      if (again.capture) return await record(ctx, row, again.capture);
      throw e;
    }
    if (isDecline(e)) return await failed(ctx, row, e.issue ?? "declined");
    // Transport failure, 5xx, 429: the claim stays; the next call retries with the same key.
    throw e;
  }
  return await record(ctx, row, cap);
}

export type OpenCheckoutResult = (
  | { kind: "redirect"; approveUrl: string; paymentId: string }
  | { kind: "funded" }
  | { kind: "processing"; why: string }
) & {
  /** Every settle this call made on the job's existing order: the caller follows each up (fan-out, alerts). */
  settled: SettleOutcome[];
};

export interface OpenCheckoutInput {
  jobId: string;
  payerId: string;
  breakdown: JobOrderBreakdown;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

/** Same order terms: the open row can be handed back instead of opening another. */
function sameTerms(a: JobOrderBreakdown | null, b: JobOrderBreakdown): boolean {
  // Every price fact paypal_job_price_matches pins, plus every amount and fee the order carries.
  return !!a && a.item_cents === b.item_cents && a.tax_cents === b.tax_cents && a.job_price_cents === b.job_price_cents
    && a.onboarding_fee_cents === b.onboarding_fee_cents && a.taxable_base_cents === b.taxable_base_cents
    && Number(a.budget) === Number(b.budget) && Number(a.urgent_fee) === Number(b.urgent_fee)
    && Boolean(a.is_urgent) === Boolean(b.is_urgent) && a.category === b.category
    && (a.helpers_needed ?? null) === (b.helpers_needed ?? null)
    && JSON.stringify(a.recurrence_days ?? null) === JSON.stringify(b.recurrence_days ?? null)
    && Number(a.helper_fee_percent) === Number(b.helper_fee_percent) && Number(a.helper_fee_flat_cents) === Number(b.helper_fee_flat_cents);
}

/**
 * Open (or reuse) the job's PayPal order and return where to send the payer.
 * The caller has already checked who may pay and what the job costs; the
 * database re-checks both under the job's lock (paypal_job_order_open).
 */
export async function openJobCheckout(ctx: JobCheckoutCtx, input: OpenCheckoutInput): Promise<OpenCheckoutResult> {
  const amountCents = input.breakdown.item_cents + input.breakdown.tax_cents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`paypal checkout amount invalid: ${amountCents}`);

  const state = await call<{ attempts: number; current: JobPaymentRow | null }>(ctx.db, "paypal_job_payment_state", { p_job_id: input.jobId });
  const current = state?.current ?? null;
  const settled: SettleOutcome[] = [];
  /** Settle the existing order; a final answer ends the request, otherwise a new order is opened. */
  const settleExisting = async (row: JobPaymentRow): Promise<OpenCheckoutResult | null> => {
    const s = await settleJobPayment(ctx, row);
    settled.push(s);
    if (s.kind === "funded") return { kind: "funded", settled };
    if (s.kind === "pending" || s.kind === "money_at_risk" || s.kind === "refused") return { kind: "processing", why: `existing order: ${s.kind}${"reason" in s ? ` (${s.reason})` : ""}`, settled };
    if (s.kind === "not_approved") return { kind: "processing", why: "existing order not approved after reading as approved", settled };
    return null; // declined / retired: a new order below
  };
  if (current) {
    sameEnv(ctx, current);
    if (FUNDED_STATUSES.has(current.status)) return { kind: "funded", settled };
    if (current.status === "capture_pending") return { kind: "processing", why: "capture pending at PayPal", settled };
    if (current.status === "approved") {
      // Approved and claimed: finish it rather than open a second order.
      const done = await settleExisting(current);
      if (done) return done;
    } else if (current.status === "created") {
      const order = await ctx.provider.getOrder(current.provider_order_id);
      if (order.status === "APPROVED" || order.status === "COMPLETED") {
        const done = await settleExisting(current);
        if (done) return done;
      } else if (order.approveUrl && order.status !== "GONE" && order.status !== "VOIDED"
                 && sameTerms(current.breakdown, input.breakdown) && Number(current.amount_cents) === amountCents) {
        // A double-tap, or the poster coming back: the same order, the same link.
        return { kind: "redirect", approveUrl: order.approveUrl, paymentId: current.id, settled };
      } else {
        // Different terms (re-priced) or dead at PayPal: retire it. Only a 'created' row is voided,
        // so a capture that claimed it a moment ago wins and this request says "processing".
        const voided = await call<boolean>(ctx.db, "paypal_job_order_void", { p_payment_id: current.id, p_reason: order.status === "GONE" ? "order expired at PayPal" : "replaced by a new checkout" });
        if (!voided) return { kind: "processing", why: "the open order was claimed while being replaced", settled };
      }
    }
  }

  const attempt = Number(state?.attempts ?? 0) + 1;
  const key = orderKey(input.jobId, amountCents, attempt);
  const created = await ctx.provider.createCheckout({
    idempotencyKey: key,
    referenceId: `job_${input.jobId}`,
    amountCents,
    itemTotalCents: input.breakdown.item_cents,
    taxTotalCents: input.breakdown.tax_cents,
    description: input.description,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
  });
  if (!created.approveUrl) {
    // We never send a payment source that completes without the payer; refuse to guess.
    throw new Error(`paypal order ${created.providerOrderId} came back ${created.status} with no approve link`);
  }
  let row: JobPaymentRow;
  try {
    row = await call<JobPaymentRow>(ctx.db, "paypal_job_order_open", {
      p_job_id: input.jobId,
      p_payer_id: input.payerId,
      p_idempotency_key: key,
      p_order_id: created.providerOrderId,
      p_amount_cents: amountCents,
      p_env: ctx.env,
      p_breakdown: input.breakdown,
    });
  } catch (e) {
    // A concurrent tap opened a different order first (one open order per job), or the job
    // moved under us. The order we just made is never recorded, so it can never be captured.
    const msg = e instanceof Error ? e.message : String(e);
    if (/provider_payments_one_open_per_subject|duplicate key/.test(msg)) return { kind: "processing", why: "another checkout for this job opened first", settled };
    throw e;
  }
  return { kind: "redirect", approveUrl: created.approveUrl, paymentId: row.id, settled };
}

/** The job's current payment row (newest not voided/failed), or null. */
export async function currentJobPayment(ctx: JobCheckoutCtx, jobId: string): Promise<JobPaymentRow | null> {
  const state = await call<{ attempts: number; current: JobPaymentRow | null }>(ctx.db, "paypal_job_payment_state", { p_job_id: jobId });
  return state?.current ?? null;
}

/** Webhook entry: the row an order id belongs to, or null (not one of our job orders). */
async function jobPaymentByOrder(ctx: JobCheckoutCtx, orderId: string): Promise<JobPaymentRow | null> {
  if (!/^[A-Z0-9]+$/.test(orderId)) return null;
  return (await call<JobPaymentRow | null>(ctx.db, "paypal_job_payment_by_order", { p_order_id: orderId })) ?? null;
}

/** What a webhook event settled: the job, and where its payment now stands. */
export interface EventSettle {
  jobId: string;
  outcome: SettleOutcome;
}

/** A verified PayPal event, as paypal-webhook stored it. */
export interface PayPalEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: unknown;
    supplementary_data?: { related_ids?: { order_id?: unknown } };
  };
}

/**
 * CHECKOUT.ORDER.APPROVED: the resource is the order. Re-read it and settle.
 * Returns null when the order is not one of our job orders (a tip, someone else's).
 */
export async function handleOrderApproved(ctx: JobCheckoutCtx, event: PayPalEvent): Promise<EventSettle | null> {
  const orderId = typeof event.resource?.id === "string" ? event.resource.id : "";
  const row = await jobPaymentByOrder(ctx, orderId);
  return row ? { jobId: row.subject_id, outcome: await settleJobPayment(ctx, row) } : null;
}

/**
 * PAYMENT.CAPTURE.COMPLETED / PENDING / DENIED / DECLINED: the resource is the capture;
 * its order id is in supplementary_data. The ORDER is re-read and settled, so a late,
 * early or repeated event can only bring the row to PayPal's current state.
 * (REFUNDED / REVERSED belong to refunds and disputes, phases 5 and 7.)
 */
export async function handleCaptureEvent(ctx: JobCheckoutCtx, event: PayPalEvent): Promise<EventSettle | null> {
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
  const row = typeof orderId === "string" ? await jobPaymentByOrder(ctx, orderId) : null;
  return row ? { jobId: row.subject_id, outcome: await settleJobPayment(ctx, row) } : null;
}
