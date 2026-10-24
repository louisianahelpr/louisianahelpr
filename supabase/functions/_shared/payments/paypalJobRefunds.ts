/**
 * Job-level PayPal refunds (PayPal Plan A, phase 5; design §6 row 5): the three doors that give a
 * poster money back on a job paid through PayPal, each through refundProviderPayment (claim first,
 * one key per business event, the database refusing once a payout is queued).
 *
 *   refundCancelledJob       a poster cancelled before the work (poster_cancel_job): fee 0 only.
 *                            A late-cancel fee (25/50%), a crew or a series waits for phase 6 and
 *                            pages ops once a day; the money stays held, never half-refunded.
 *   adminRefundPayPalJob     an admin's refund, full (the job is cancelled) or partial.
 *   settleRefundAgreement    an agreed refund request (Board 141): the poster's part refunded first,
 *                            then (a partial one) the Helpr's rest queued in phase 4's pay queue.
 *
 * WHAT A REFUND KEEPS (owner 2026-10-14: "if admin refunds we keep the fee also. we should never
 * absorb any fee"): PayPal keeps its processing fee on every refund (sandbox 2026-10-23: refund
 * paypal_fee 0.00, the capture's fee not returned), so every refund here returns what was paid less
 * PayPal's real fee on that capture (read from PayPal, never estimated), less a first job's setup
 * fee and the tax on what is kept: _shared/refundAmount.ts refundToPayerCents, the same rule as
 * Stripe's paths.
 *
 * readPayPalJobPayment / payPalFundedJobIds are the predicates every Stripe-era money path uses to
 * keep its hands off a PayPal job (void-cancelled-payments Part A, create-payment's refund doors, execute-dispute-split,
 * refund-request-sweep): to those paths a PayPal job has no PaymentIntent and would read as "no
 * money was ever taken" (src/test/stripePathsSkipPayPalJobs.test.ts).
 */
import { roundPayoutDownCents } from "../money.ts";
import { refundToPayerCents } from "../refundAmount.ts";
import { agreedRushRefundCents } from "../refundRush.ts";
import { netUrgentFeeDollars } from "../stripeFees.ts";
import { helprFlatFeeCents } from "../helprFlatFee.ts";
import { refundNoticeProblem, sendRefundNotice } from "../refundNotice.ts";
import type { PayPalClient } from "./paypalClient.ts";
import { readCapture, readRefund } from "./paypalReads.ts";
import { refundProviderPayment, type RefundOutcome, type RefundRpc } from "./providerRefunds.ts";
import type { PaymentProvider } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = RefundRpc & { from: (table: string) => any };
type Alert = (input: { kind: string; severity?: string; title: string; message: string; oncePerDayKey?: string; fields?: Record<string, string | number | null | undefined> }) => Promise<unknown>;

export interface JobRefundDeps {
  db: Db;
  provider: PaymentProvider;
  client: PayPalClient;
  alert: Alert;
}

/** provider_payments statuses that mean money came in through PayPal (whatever happened since). */
const PAYPAL_MONEY_STATUSES = ["capture_pending", "captured", "partially_refunded", "refunded", "disputed", "reversed"];
/** The ones a refund can still come out of. */
const REFUNDABLE = new Set(["captured", "partially_refunded"]);

export interface PayPalJobPayment {
  id: string;
  status: string;
  amount_cents: number;
  provider_capture_id: string | null;
  env: string;
  /** Phase 3's checkout breakdown (absent before it lands); the setup fee it charged is kept on a refund. */
  breakdown?: { onboarding_fee_cents?: number | string | null } | null;
}

/** The PayPal payment on a job, or null for a Stripe-era / unpaid job. Fails CLOSED: an error is returned, never "none". */
export async function readPayPalJobPayment(db: { from: (t: string) => any }, jobId: string): Promise<{ payment: PayPalJobPayment | null; error: string | null }> {
  // "*": phase 3's breakdown column is read when it exists, and this read never names a column
  // that a deploy order could leave missing (a failed read here fails closed everywhere).
  const { data, error } = await db.from("provider_payments")
    .select("*")
    .eq("subject_kind", "job").eq("subject_id", jobId)
    .in("status", PAYPAL_MONEY_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { payment: null, error: error.message };
  const row = (data ?? [])[0] as PayPalJobPayment | undefined;
  return { payment: row ?? null, error: null };
}

/** Of these jobs, the ones paid through PayPal. Fails CLOSED (error returned). */
export async function payPalFundedJobIds(db: { from: (t: string) => any }, jobIds: string[]): Promise<{ ids: Set<string>; error: string | null }> {
  if (jobIds.length === 0) return { ids: new Set(), error: null };
  const { data, error } = await db.from("provider_payments")
    .select("subject_id")
    .eq("subject_kind", "job").in("subject_id", jobIds)
    .in("status", PAYPAL_MONEY_STATUSES);
  if (error) return { ids: new Set(), error: error.message };
  return { ids: new Set(((data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)), error: null };
}

interface JobMoneyRow {
  id: string;
  title: string | null;
  status: string;
  payment_status: string | null;
  customer_id: string | null;
  customer_fee_amount: number | null;
  onboarding_fee_amount: number | null;
  sales_tax_amount: number | null;
  cancellation_fee: number | null;
}
const JOB_COLS = "id, title, status, payment_status, customer_id, customer_fee_amount, onboarding_fee_amount, sales_tax_amount, cancellation_fee";

const cents = (dollars: number | null | undefined) => Math.max(0, Math.round(Number(dollars ?? 0) * 100));

interface ClaimRow {
  id: string;
  provider_payment_id: string;
  amount_cents: number;
  status: string;
  provider_refund_id: string | null;
  reason: string | null;
}

/** The claim already made for this key, if any. Fails CLOSED (throws on a read error). */
async function existingClaim(db: Db, key: string): Promise<ClaimRow | null> {
  const { data, error } = await db.from("provider_refunds")
    .select("id, provider_payment_id, amount_cents, status, provider_refund_id, reason")
    .eq("idempotency_key", key).maybeSingle();
  if (error) throw new Error(`refund claim read failed: ${error.message}`);
  return (data as ClaimRow | null) ?? null;
}

/** Live (pending + completed) refunds of a payment, leaving out one key (the caller's own). */
async function liveRefundedCents(db: Db, paymentId: string, exceptKey: string | null): Promise<number> {
  let q = db.from("provider_refunds").select("amount_cents")
    .eq("provider_payment_id", paymentId).in("status", ["pending", "completed"]);
  if (exceptKey) q = q.neq("idempotency_key", exceptKey);
  const { data, error } = await q;
  if (error) throw new Error(`refund total read failed: ${error.message}`);
  return ((data ?? []) as Array<{ amount_cents: number }>).reduce((s, r) => s + Number(r.amount_cents), 0);
}

/**
 * How much may go back now: captured less PayPal's fee, setup fee, the tax on them and earlier
 * refunds (other keys only: `ownKey`'s claim is the one being decided).
 */
export async function refundableNow(deps: JobRefundDeps, payment: PayPalJobPayment, job: JobMoneyRow, requestedCents: number | null, ownKey: string | null = null) {
  if (!payment.provider_capture_id) throw new Error("payment has no capture");
  const cap = await readCapture(deps.client, payment.provider_capture_id);
  if (cap.amountCents !== payment.amount_cents) throw new Error(`capture ${cap.id} is ${cap.amountCents} cents, our row says ${payment.amount_cents}`);
  if (cap.feeCents === null) throw new Error(`capture ${cap.id} has no PayPal fee yet; refund later`);
  const already = await liveRefundedCents(deps.db, payment.id, ownKey);
  return refundToPayerCents({
    capturedCents: payment.amount_cents,
    actualFeeCents: cap.feeCents,
    customerFeeCents: cents(job.customer_fee_amount),
    // The one-time setup fee is kept (owner Q1346/Q1674): Stripe-era jobs carry it on the job,
    // PayPal checkouts (phase 3) in the payment's breakdown (lh-money-escrow review #3).
    setupFeeCents: Math.max(cents(job.onboarding_fee_amount), Math.max(0, Math.round(Number(payment.breakdown?.onboarding_fee_cents ?? 0)))),
    taxCents: cents(job.sales_tax_amount),
    alreadyRefundedCents: already,
    requestedCents,
  });
}

/** keptIsFee: what the payment kept is PayPal's fee (and the tax on it), not money a partial refund left. */
async function tellPayer(deps: JobRefundDeps, job: JobMoneyRow, out: Extract<RefundOutcome, { kind: "refunded" }>, keptCents: number, taxKeptCents: number, keptIsFee: boolean) {
  // Told already by the run that first recorded PayPal's answer (sendRefundNotice also dedupes by key).
  if (out.replay) return;
  const told = await sendRefundNotice(deps.db, {
    key: `refund:${out.providerRefundId}`,
    kind: "refund",
    paymentIntentId: null,
    amountCents: out.amountCents,
    keptCents,
    keptReason: keptIsFee && keptCents > 0 ? "PayPal's processing fee, which PayPal does not return on a refund" : null,
    taxKeptCents: keptIsFee ? taxKeptCents : 0,
    method: { type: "paypal" },
    jobId: job.id,
    jobByPayment: false,
    testMode: deps.provider.env === "sandbox",
  });
  const problem = refundNoticeProblem(told);
  if (problem) {
    await deps.alert({ kind: "custom", severity: "warning", title: "PayPal refund notice not sent", message: `Job ${job.id}: ${problem}`, oncePerDayKey: `paypal-refund-notice:${job.id}` });
  }
}

async function pageOutcome(deps: JobRefundDeps, where: string, jobId: string, out: RefundOutcome) {
  if (out.kind === "refunded" && out.amountMismatch) {
    await deps.alert({
      kind: "money_at_risk", severity: "critical", title: "PayPal refunded a different amount than asked (refund_amount_mismatch)",
      message: `${where} job ${jobId}: asked ${out.askedCents} cents, PayPal refunded ${out.amountCents} (${out.providerRefundId}); the ledger now records ${out.amountCents}. Our ledger and PayPal disagreed about what was left: check this payment's other refunds.`,
      fields: { job_id: jobId, refund_row: out.refundRowId, paypal_refund: out.providerRefundId },
    });
  }
  if (out.kind === "recorded_late") {
    await deps.alert({
      kind: "money_at_risk", severity: "critical", title: "PayPal refund made but not recorded",
      message: `${where} job ${jobId}: PayPal refunded ${out.amountCents} cents (${out.providerRefundId}) but provider_refunds did not take it: ${out.message}. PAYMENT.CAPTURE.REFUNDED will attach it; check the row.`,
      fields: { job_id: jobId, refund_row: out.refundRowId, paypal_refund: out.providerRefundId },
    });
  } else if (out.kind === "retry") {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund not finished", message: `${where} job ${jobId}: ${out.message.slice(0, 300)}. The next run retries with the same key.`, oncePerDayKey: `paypal-refund-retry:${where}:${jobId}` });
  } else if (out.kind === "refused" && out.code === "refund_after_payout_queued") {
    // Not an error in the admin door (the admin is told), but a cancelled job whose Helpr payout is
    // queued needs a person: cancel the payout or settle by hand.
    if (where !== "admin") {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund blocked by a queued payout", message: `${where} job ${jobId}: a Helpr payout of this payment is queued, held or sent, so the poster cannot be refunded until an admin cancels it or settles by hand.`, oncePerDayKey: `paypal-refund-payout-queued:${where}:${jobId}` });
    }
  } else if (out.kind === "refused") {
    await deps.alert({ kind: "money_at_risk", severity: "critical", title: "PayPal refund refused", message: `${where} job ${jobId}: ${out.code}: ${out.message.slice(0, 300)}. The poster has not been refunded.`, oncePerDayKey: `paypal-refund-refused:${where}:${jobId}` });
  }
}

export interface CancelledDueRow {
  job_id: string;
  provider_payment_id: string;
  payment_amount_cents: number;
  job_payment_status: string | null;
  cancellation_fee_cents: number;
  has_crew: boolean;
  is_series: boolean;
  /** Earlier cancel-refund attempts that failed or were cancelled at PayPal. */
  cancel_attempts: number;
}

/** A cancelled job's refund key; a later attempt after a FAILED/CANCELLED one gets its own key. */
export const cancelRefundKey = (jobId: string, earlierAttempts = 0) =>
  earlierAttempts > 0 ? `lh:job:${jobId}:refund:cancel:a${earlierAttempts + 1}` : `lh:job:${jobId}:refund:cancel`;
const CANCEL_KEY_RE = /^lh:job:([0-9a-f-]{36}):refund:cancel(?::a\d+)?$/;
const ADMIN_KEY_RE = /^lh:job:([0-9a-f-]{36}):refund:admin:[0-9a-f-]{36}$/;
const MAX_CANCEL_ATTEMPTS = 3;

/** One cancelled PayPal job. Returns a short outcome word for the sweep's summary. */
export async function refundCancelledJob(deps: JobRefundDeps, due: CancelledDueRow): Promise<string> {
  const jobId = due.job_id;
  if (due.has_crew || due.is_series || Number(due.cancellation_fee_cents) > 0) {
    // Phase 6 (cancellation fees, crews, repeat visits). Held, never half-refunded.
    await deps.alert({
      kind: "money_at_risk", severity: "warning", title: "Cancelled PayPal job waits for the cancellation-fee build",
      message: `Job ${jobId} was cancelled with ${due.has_crew ? "a crew" : due.is_series ? "a repeat series" : `a ${due.cancellation_fee_cents}-cent late-cancel fee`}. PayPal phase 5 refunds only fee-free cancellations; the poster's money stays held until phase 6 (or an admin refunds it by hand).`,
      oncePerDayKey: `paypal-cancel-held:${jobId}`,
    });
    return "held_for_phase6";
  }
  if (Number(due.cancel_attempts) >= MAX_CANCEL_ATTEMPTS) {
    await deps.alert({ kind: "money_at_risk", severity: "critical", title: "PayPal cancel refund failed repeatedly", message: `Job ${jobId}: PayPal failed or cancelled the cancel refund ${due.cancel_attempts} times. The poster has NOT been refunded; refund by hand from the admin screen.`, oncePerDayKey: `paypal-cancel-gave-up:${jobId}` });
    return "gave_up";
  }
  const { data: job, error: jobErr } = await deps.db.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
  if (jobErr || !job) return `job_read_failed:${jobErr?.message ?? "missing"}`;
  if ((job as JobMoneyRow).status !== "cancelled") return "no_longer_cancelled";
  const { data: payRow, error: payErr } = await deps.db.from("provider_payments")
    .select("*").eq("id", due.provider_payment_id).maybeSingle();
  if (payErr || !payRow) return `payment_read_failed:${payErr?.message ?? "missing"}`;
  const payment = payRow as PayPalJobPayment;
  if (!REFUNDABLE.has(payment.status)) return `not_refundable:${payment.status}`;
  const key = cancelRefundKey(jobId, Number(due.cancel_attempts));
  let amounts;
  try {
    amounts = await refundableNow(deps, payment, job as JobMoneyRow, null, key);
  } catch (e) {
    // Not a transient read: a capture that disagrees with our row, or no fee yet. Once a day, not
    // a red run every 10 minutes.
    const why = e instanceof Error ? e.message : String(e);
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "Cancelled PayPal job: refund amount unknown", message: `Job ${jobId}: ${why}. The poster has not been refunded yet.`, oncePerDayKey: `paypal-cancel-amount:${jobId}` });
    return `amount_unknown:${why}`;
  }
  if (amounts.refundCents <= 0) {
    await deps.alert({ kind: "custom", severity: "info", title: "Cancelled PayPal job: nothing to refund", message: `Job ${jobId}: PayPal's fee and earlier refunds take the whole payment.`, oncePerDayKey: `paypal-cancel-nothing:${jobId}` });
    return "nothing_refundable";
  }
  const out = await refundProviderPayment(deps.db, deps.provider, {
    paymentId: payment.id,
    idempotencyKey: key,
    amountCents: amounts.refundCents,
    reason: "poster cancelled before the work; no cancellation fee",
    noteToPayer: "Your Louisiana Helpr job was cancelled. PayPal keeps its processing fee.",
    maxTotalCents: amounts.ceilingCents,
  });
  return await afterCancelRefund(deps, job as JobMoneyRow, out, payment.amount_cents, amounts.taxKeptCents);
}

async function afterCancelRefund(deps: JobRefundDeps, job: JobMoneyRow, out: RefundOutcome, capturedCents: number, taxKeptCents = 0): Promise<string> {
  await pageOutcome(deps, "cancel", job.id, out);
  if (out.kind !== "refunded") return out.kind === "refused" ? `refused:${out.code}` : out.kind;
  // The job's money is settled: pinned to cancelled, so a job that moved in between keeps its own.
  const flip = await deps.db.from("jobs").update({ payment_status: "refunded" })
    .eq("id", job.id).eq("status", "cancelled")
    .select("id");
  if (flip.error || (flip.data ?? []).length === 0) {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund made, job not marked refunded", message: `Job ${job.id}: refunded ${out.amountCents} cents (${out.providerRefundId}) but the job flip ${flip.error ? `failed: ${flip.error.message}` : "matched no row (the job moved)"}.`, oncePerDayKey: `paypal-cancel-flip:${job.id}` });
  }
  await tellPayer(deps, job, out, Math.max(0, capturedCents - out.amountCents), taxKeptCents, true);
  return out.replay ? "already_refunded" : "refunded";
}

/**
 * What follows a finished refund for its key, whoever finished it (the lost-answer retry here; the
 * doors run their own). Cancel: settle the job and tell the poster. Admin: a full one cancels the
 * job (as the door does), then tell the poster. Agreement: the next hand-out re-runs the settle
 * (which replays the refund and queues the Helpr's part); here it only pages.
 */
async function afterRefund(deps: JobRefundDeps, row: ClaimRow & { idempotency_key: string }, out: RefundOutcome): Promise<void> {
  const cancel = CANCEL_KEY_RE.exec(row.idempotency_key);
  const admin = ADMIN_KEY_RE.exec(row.idempotency_key);
  const jobId = cancel?.[1] ?? admin?.[1] ?? null;
  if (!jobId) {
    await pageOutcome(deps, "retry", row.idempotency_key, out);
    return;
  }
  const [{ data: job, error: jobErr }, { data: pay, error: payErr }] = await Promise.all([
    deps.db.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle(),
    deps.db.from("provider_payments").select("amount_cents").eq("id", row.provider_payment_id).maybeSingle(),
  ]);
  if (jobErr || payErr || !job || !pay) {
    // Never silent: the outcome itself is paged, and the missing follow-up with it.
    await pageOutcome(deps, cancel ? "cancel" : "admin", jobId, out);
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund follow-up not run", message: `Job ${jobId} (${row.idempotency_key}): ${out.kind}; the job/payment read failed (${jobErr?.message ?? payErr?.message ?? "missing row"}), so the job was not settled and the poster not told. Check it by hand.`, oncePerDayKey: `paypal-refund-followup:${row.id}` });
    return;
  }
  const captured = Number((pay as { amount_cents: number }).amount_cents);
  if (cancel) {
    await afterCancelRefund(deps, job as JobMoneyRow, out, captured);
    return;
  }
  await pageOutcome(deps, "admin", jobId, out);
  if (out.kind !== "refunded") return;
  const full = (row.reason ?? "").startsWith("admin_full");
  if (full) {
    const flip = await deps.db.from("jobs").update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", jobId).neq("status", "disputed").select("id");
    if (flip.error || (flip.data ?? []).length === 0) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal admin refund made, job not cancelled", message: `Job ${jobId}: ${flip.error?.message ?? "matched no row"}.`, oncePerDayKey: `paypal-admin-flip:${jobId}` });
    }
  }
  let other = 0;
  try {
    other = await liveRefundedCents(deps.db, row.provider_payment_id, row.idempotency_key);
  } catch (e) {
    console.error(`[paypal-refunds] refund total read failed for ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  await tellPayer(deps, job as JobMoneyRow, out, Math.max(0, captured - other - out.amountCents), 0, full);
}

/**
 * A refund the webhook (or the pending re-check) just recorded for one of our keys, whose door did
 * not see PayPal's answer (it timed out): run that door's follow-up now (settle the job, tell the
 * poster). Reads fail loudly through afterRefund.
 */
export async function followUpRecordedRefund(deps: JobRefundDeps, refundRowId: string): Promise<void> {
  const { data, error } = await deps.db.from("provider_refunds")
    .select("id, provider_payment_id, idempotency_key, amount_cents, status, provider_refund_id, reason")
    .eq("id", refundRowId).maybeSingle();
  if (error || !data) {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund follow-up not run", message: `provider_refunds ${refundRowId}: ${error?.message ?? "row not found"}.`, oncePerDayKey: `paypal-refund-followup:${refundRowId}` });
    return;
  }
  const row = data as ClaimRow & { idempotency_key: string };
  if (!row.provider_refund_id || (row.status !== "completed" && row.status !== "pending")) return;
  await afterRefund(deps, row, {
    kind: "refunded", refundRowId: row.id, providerRefundId: row.provider_refund_id, settled: row.status === "completed",
    amountCents: Number(row.amount_cents), askedCents: Number(row.amount_cents), amountMismatch: false, replay: false, paymentStatus: null,
  });
}

interface PendingRow { id: string; provider_payment_id: string; idempotency_key: string; amount_cents: number; status: string; provider_refund_id: string | null; reason: string | null; created_at: string; updated_at: string }

/**
 * The sweep's second half: refunds not finished yet.
 *   (a) a claim whose PayPal answer was lost (pending, no PayPal id, claimed 2-60 minutes ago): asked
 *       again with the SAME key, so PayPal answers with the same refund;
 *   (b) older than an hour with no answer: a person checks PayPal first (PayPal's memory of a
 *       PayPal-Request-Id is not on the pages read; ASSUMED hours), paged once a day each;
 *   (c) PENDING at PayPal for over an hour (a PayPal id, webhook not arrived): re-read from PayPal
 *       and reconciled, paged once a day each after 24 hours still pending.
 */
export async function retryLostRefunds(deps: JobRefundDeps, now = Date.now()): Promise<{ retried: number; finished: number; stale: number; rechecked: number }> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const cols = "id, provider_payment_id, idempotency_key, amount_cents, status, provider_refund_id, reason, created_at, updated_at";
  const [lost, staleRows, pendingAtPayPal] = await Promise.all([
    deps.db.from("provider_refunds").select(cols).eq("status", "pending").is("provider_refund_id", null)
      .lt("created_at", iso(now - 2 * 60_000)).gte("created_at", iso(now - 60 * 60_000)).like("idempotency_key", "lh:%")
      .order("created_at", { ascending: true }).limit(20),
    deps.db.from("provider_refunds").select(cols).eq("status", "pending").is("provider_refund_id", null)
      .lt("created_at", iso(now - 60 * 60_000)).like("idempotency_key", "lh:%")
      .order("created_at", { ascending: true }).limit(20),
    deps.db.from("provider_refunds").select(cols).eq("status", "pending").not("provider_refund_id", "is", null)
      .lt("updated_at", iso(now - 60 * 60_000))
      .order("updated_at", { ascending: true }).limit(20),
  ]);
  for (const r of [lost, staleRows, pendingAtPayPal]) if (r.error) throw new Error(`unfinished-refund read failed: ${r.error.message}`);
  let retried = 0, finished = 0, stale = 0, rechecked = 0;
  for (const row of (staleRows.data ?? []) as PendingRow[]) {
    stale++;
    await deps.alert({ kind: "money_at_risk", severity: "critical", title: "PayPal refund unanswered for over an hour", message: `provider_refunds ${row.id} (${row.idempotency_key}, ${row.amount_cents} cents) has no PayPal answer. Check PayPal's activity for this capture before retrying by hand.`, oncePerDayKey: `paypal-refund-stale:${row.id}` });
  }
  for (const row of (lost.data ?? []) as PendingRow[]) {
    retried++;
    const out = await refundProviderPayment(deps.db, deps.provider, { paymentId: row.provider_payment_id, idempotencyKey: row.idempotency_key, amountCents: Number(row.amount_cents), reason: "retry" });
    if (out.kind === "refunded") finished++;
    await afterRefund(deps, row, out);
  }
  for (const row of (pendingAtPayPal.data ?? []) as PendingRow[]) {
    rechecked++;
    try {
      const r = await readRefund(deps.client, row.provider_refund_id!);
      const rec = await deps.db.rpc("paypal_refund_reconcile", {
        p_env: deps.provider.env, p_capture_id: r.captureId, p_provider_refund_id: r.id, p_status: r.status, p_amount_cents: r.amountCents, p_refund_row_hint: row.id,
      });
      if (rec.error) throw new Error(rec.error.message);
      if (r.status === "failed" || r.status === "cancelled") await pageRefundUndone(deps, row.idempotency_key, r.id, r.status);
      if (r.status === "pending" && now - Date.parse(row.created_at) > 24 * 3600_000) {
        await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund pending for over a day", message: `provider_refunds ${row.id} (${row.idempotency_key}): PayPal still says PENDING for refund ${r.id}.`, oncePerDayKey: `paypal-refund-pending-day:${row.id}` });
      }
    } catch (e) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal pending refund could not be re-checked", message: `provider_refunds ${row.id} (${row.idempotency_key}): ${e instanceof Error ? e.message : String(e)}`, oncePerDayKey: `paypal-refund-recheck:${row.id}` });
    }
  }
  return { retried, finished, stale, rechecked };
}

/**
 * A refund we had recorded as made came back FAILED or CANCELLED from PayPal: the poster may have
 * been told it was refunded. Page a person, and put a cancelled job's money back in the cancel
 * hand-out (jobs.payment_status back to 'escrow'; paypal_cancelled_job_refunds_due then offers it
 * again under a new attempt key, at most MAX_CANCEL_ATTEMPTS times).
 */
export async function pageRefundUndone(deps: JobRefundDeps, key: string, paypalRefundId: string, status: string): Promise<void> {
  const cancel = CANCEL_KEY_RE.exec(key);
  let reopened = "";
  if (cancel) {
    const back = await deps.db.from("jobs").update({ payment_status: "escrow" })
      .eq("id", cancel[1]).eq("status", "cancelled").eq("payment_status", "refunded").select("id");
    reopened = back.error ? ` Reopening the job for a new refund failed: ${back.error.message}.` : (back.data ?? []).length > 0 ? " The job is back in the cancel sweep for a new attempt." : "";
  }
  await deps.alert({
    kind: "money_at_risk", severity: "critical", title: "PayPal refund failed after it was recorded",
    message: `PayPal refund ${paypalRefundId} (${key}) is ${status.toUpperCase()}. The poster may have been told they were refunded; they were not.${reopened}`,
    fields: { key, paypal_refund: paypalRefundId },
  });
}

export interface OrphanDueRow {
  provider_payment_id: string;
  subject_kind: string;
  subject_id: string;
  payer_id: string | null;
  amount_cents: number;
  env: string;
  orphan_reason: string | null;
  failed_attempts: number;
}

/**
 * An orphan capture (phase 3: a capture that could not fund its job, e.g. a second tab's second
 * payment): refunded IN FULL, PayPal's fee included (the money was never ours: owner 2026-10-14,
 * a refund caused by our side goes back in full), automatically, under its own key. A fully
 * refunded orphan reads 'refunded', which clears phase 3's orphan alert.
 */
export async function refundOrphan(deps: JobRefundDeps, row: OrphanDueRow): Promise<string> {
  const tries = Number(row.failed_attempts);
  if (tries >= MAX_CANCEL_ATTEMPTS) {
    await deps.alert({ kind: "money_at_risk", severity: "critical", title: "Orphan PayPal payment could not be refunded", message: `Payment ${row.provider_payment_id} (${row.orphan_reason ?? "orphan"}, ${row.amount_cents} cents): PayPal failed the full refund ${tries} times. Refund it by hand in PayPal.`, oncePerDayKey: `paypal-orphan-gave-up:${row.provider_payment_id}` });
    return "gave_up";
  }
  const key = `lh:pp:${row.provider_payment_id}:refund:orphan${tries > 0 ? `:a${tries + 1}` : ""}`;
  const out = await refundProviderPayment(deps.db, deps.provider, {
    paymentId: row.provider_payment_id,
    idempotencyKey: key,
    amountCents: Number(row.amount_cents),
    reason: `orphan capture refunded in full (${row.orphan_reason ?? "orphan"})`,
    noteToPayer: "This PayPal payment to Louisiana Helpr did not go through to a job, so it is refunded in full.",
    maxTotalCents: Number(row.amount_cents),
  });
  await pageOutcome(deps, "orphan", row.subject_id, out);
  if (out.kind !== "refunded") return out.kind === "refused" ? `refused:${out.code}` : out.kind;
  if (row.subject_kind === "job") {
    const { data: job, error } = await deps.db.from("jobs").select(JOB_COLS).eq("id", row.subject_id).maybeSingle();
    if (!error && job) await tellPayer(deps, job as JobMoneyRow, out, 0, 0, false);
  }
  return out.replay ? "already_refunded" : "refunded";
}

/** The safety net: a cancelled job whose cancel refund is done at PayPal but not on the job yet. */
export async function settleUnsettledCancels(deps: JobRefundDeps): Promise<number> {
  const { data, error } = await deps.db.rpc("paypal_cancelled_jobs_unsettled", { p_limit: 20 });
  if (error) throw new Error(`unsettled-cancel read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ job_id: string; refund_id: string }>;
  for (const r of rows) await followUpRecordedRefund(deps, r.refund_id);
  return rows.length;
}

export interface AdminRefundInput {
  adminId: string;
  jobId: string;
  /** Omitted = everything refundable (the job is cancelled). */
  amountCents?: number | null;
  /** The admin screen's request id: one press, one refund, however often it is resent. */
  requestId: string;
  reason: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** { status, body } for the HTTP answer. The caller has already checked admin role and the switch. */
export async function adminRefundPayPalJob(deps: JobRefundDeps, input: AdminRefundInput): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!UUID_RE.test(input.requestId ?? "")) return { status: 400, body: { error: "A refund needs its request id (refresh the page and try again)." } };
  if (input.amountCents != null && (!Number.isInteger(input.amountCents) || input.amountCents <= 0)) {
    return { status: 400, body: { error: "The refund amount must be a whole number of cents above zero." } };
  }
  const { data: job, error: jobErr } = await deps.db.from("jobs").select(JOB_COLS).eq("id", input.jobId).maybeSingle();
  if (jobErr) return { status: 503, body: { error: "Couldn't read the job. No money was moved; try again." } };
  if (!job) return { status: 404, body: { error: "Job not found" } };
  const j = job as JobMoneyRow;
  if (j.status === "disputed") {
    return { status: 409, body: { error: "This job is under dispute, so it is settled by the dispute decision, not a general refund. No money was moved.", disputed: true } };
  }
  const found = await readPayPalJobPayment(deps.db, j.id);
  if (found.error) return { status: 503, body: { error: "Couldn't read the job's PayPal payment. No money was moved; try again." } };
  const payment = found.payment;
  const key = `lh:job:${j.id}:refund:admin:${input.requestId.toLowerCase()}`;
  let prior: ClaimRow | null;
  try {
    prior = await existingClaim(deps.db, key);
  } catch {
    return { status: 503, body: { error: "Couldn't check for this refund in progress. No money was moved; try again." } };
  }
  let amountCents: number;
  let full: boolean;
  let taxKeptCents = 0;
  let maxTotal: number | undefined;
  if (prior) {
    // The same press again (a retry after a timeout): finish THAT refund, at its own amount.
    amountCents = Number(prior.amount_cents);
    full = (prior.reason ?? "").startsWith("admin_full");
  } else {
    if (!payment || !REFUNDABLE.has(payment.status)) {
      return { status: 409, body: { error: payment ? `This PayPal payment is ${payment.status.replace(/_/g, " ")}, so nothing more can be refunded here.` : "This job has no PayPal payment to refund." } };
    }
    // A DIFFERENT press while an earlier one still waits for PayPal (a reopened dialog): refused, so
    // two presses never become two refunds.
    const { data: waiting, error: waitErr } = await deps.db.from("provider_refunds").select("id")
      .eq("provider_payment_id", payment.id).eq("status", "pending").is("provider_refund_id", null)
      .like("idempotency_key", `lh:job:${j.id}:refund:admin:%`).limit(1);
    if (waitErr) return { status: 503, body: { error: "Couldn't check for a refund in progress. No money was moved; try again." } };
    if ((waiting ?? []).length > 0) {
      return { status: 409, body: { error: "An earlier refund of this job is still waiting for PayPal's answer; it finishes on its own within minutes. No new refund was made.", pending: true } };
    }
    let amounts;
    try {
      amounts = await refundableNow(deps, payment, j, input.amountCents ?? null, key);
    } catch (e) {
      return { status: 503, body: { error: `Couldn't work out the refundable amount from PayPal (${e instanceof Error ? e.message : String(e)}). No money was moved.` } };
    }
    if (amounts.refundCents <= 0) {
      return { status: 409, body: { error: "Nothing is left to refund: PayPal's processing fee and earlier refunds take the rest.", remainingCents: amounts.remainingCents } };
    }
    if (input.amountCents != null && input.amountCents > amounts.remainingCents) {
      return { status: 409, body: { error: `At most ${amounts.remainingCents} cents can go back (PayPal keeps its processing fee). No money was moved.`, remainingCents: amounts.remainingCents } };
    }
    // A partial that takes everything left is a full refund in disguise (Stripe's Q1320 rule): it
    // would leave the job payable with nothing behind it. Use the full refund, which cancels the job.
    if (input.amountCents != null && input.amountCents >= amounts.remainingCents) {
      return { status: 409, body: { error: "That is everything left on this payment. Use a full refund instead: it also cancels the job. No money was moved.", remainingCents: amounts.remainingCents } };
    }
    // A full refund of a cancelled job that owes its Helpr a late-cancel fee would give that fee to
    // the poster (lh-money-escrow review #7): late-cancel fees on PayPal are phase 6.
    if (input.amountCents == null && j.status === "cancelled" && cents(j.cancellation_fee) > 0) {
      return { status: 409, body: { error: `This cancelled job owes its Helpr a ${(cents(j.cancellation_fee) / 100).toFixed(2)} late-cancel fee, so a full refund would give that away. Refund the rest as a partial refund instead. No money was moved.` } };
    }
    amountCents = amounts.refundCents;
    maxTotal = amounts.ceilingCents;
    full = input.amountCents == null;
    taxKeptCents = amounts.taxKeptCents;
  }
  const out = await refundProviderPayment(deps.db, deps.provider, {
    paymentId: prior?.provider_payment_id ?? payment!.id,
    idempotencyKey: key,
    amountCents,
    reason: `${full ? "admin_full" : "admin_partial"} ${input.adminId}: ${input.reason}`.slice(0, 500),
    noteToPayer: "Refund from Louisiana Helpr. PayPal keeps its processing fee.",
    maxTotalCents: maxTotal,
  });
  await pageOutcome(deps, "admin", j.id, out);
  if (out.kind === "refused") {
    const why = out.code === "refund_after_payout_queued"
      ? "A payout of this job to the Helpr is queued or sent, so it can't be refunded here. Cancel the payout first."
      : out.code === "refund_exceeds_payment" || out.code === "refund_exceeds_refundable" ? "That is more than is left on this payment (PayPal keeps its processing fee)." : `PayPal or the ledger refused it (${out.code}).`;
    return { status: 409, body: { error: `${why} No money was moved.`, code: out.code } };
  }
  if (out.kind === "retry") return { status: 503, body: { error: "PayPal did not answer. Press again: the same refund is retried, never doubled.", retry: true } };
  if (out.kind === "recorded_late") return { status: 500, body: { error: "PayPal refunded it, but our ledger is behind. Ops has been paged.", paypalRefundId: out.providerRefundId, recordedLate: true } };
  if (full) {
    // A full admin refund cancels the job, as admin_refund_general does on Stripe.
    const flip = await deps.db.from("jobs").update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", j.id).neq("status", "disputed").select("id");
    if (flip.error || (flip.data ?? []).length === 0) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal admin refund made, job not cancelled", message: `Job ${j.id}: ${flip.error?.message ?? "matched no row"}.`, oncePerDayKey: `paypal-admin-flip:${j.id}` });
    }
  }
  let other = 0;
  try {
    other = await liveRefundedCents(deps.db, prior?.provider_payment_id ?? payment!.id, key);
  } catch (e) {
    console.error(`[create-payment] refund total read failed for ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const captured = payment?.amount_cents ?? amountCents;
  await tellPayer(deps, j, out, Math.max(0, captured - other - out.amountCents), taxKeptCents, full);
  return { status: 200, body: { refunded: true, amountCents: out.amountCents, paypalRefundId: out.providerRefundId, settled: out.settled, replay: out.replay, full } };
}

/**
 * An agreed refund request (Board 141) on a PayPal job. Service only (refund-request-sweep).
 *
 *   all  the poster gets back everything refundable (less PayPal's fee); the job is cancelled
 *        (refund_agreements_due already flipped it) and marked refunded.
 *   part the poster gets the agreed amount back, plus the rush fee in the same share
 *        (refundRush.ts), exactly as execute-dispute-split's agreement path; then the Helpr's rest,
 *        after their fee and rounded down to the dollar (Q236), is queued for the admin pay queue
 *        (phase 4: paypal_queue_manual_payout, source 'refund_request_remainder'). REFUND FIRST: the
 *        database refuses a refund once a payout is queued. A taxed charge is left to an admin, as on
 *        Stripe (Q1998).
 * The dispute is claimed ('executing') before any money moves, marked executed only when both legs
 * are done (the payout queued, queued_held or already_queued), and set back to 'failed' with the
 * reason otherwise; a re-run is a no-op for every leg already done (the refund key replays).
 */
export async function settleRefundAgreement(deps: JobRefundDeps, disputeId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const proof = await deps.db.rpc("refund_agreement_for_dispute", { p_dispute_id: disputeId });
  if (proof.error) return { status: 503, body: { error: `agreement read failed: ${proof.error.message}` } };
  const ag = proof.data as { job_id?: string; helper_id?: string; amount_cents?: number; budget_cents?: number } | null;
  if (!ag?.job_id || !ag.helper_id) return { status: 403, body: { error: "no recorded agreement for this dispute" } };
  const partial = Number(ag.amount_cents) < Number(ag.budget_cents);
  const markFailed = async (why: string) => {
    const { data, error } = await deps.db.from("disputes").update({ execution_status: "failed", execution_error: why.slice(0, 500) })
      .eq("id", disputeId).eq("execution_status", "executing").select("id");
    if (error || (data ?? []).length === 0) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal agreement: dispute not marked failed", message: `Dispute ${disputeId}: ${error?.message ?? "matched no row"} while recording: ${why.slice(0, 200)}. It may sit 'executing'.`, oncePerDayKey: `paypal-agreement-markfailed:${disputeId}` });
    }
  };
  // Claim the dispute's execution (one settler at a time; a failed run is claimable again).
  const claim = await deps.db.from("disputes").update({ execution_status: "executing", execution_started_at: new Date().toISOString() })
    .eq("id", disputeId).eq("status", "decided").or("execution_status.is.null,execution_status.in.(pending,failed)")
    .select("id");
  if (claim.error) return { status: 503, body: { error: `claim failed: ${claim.error.message}` } };
  if ((claim.data ?? []).length === 0) return { status: 409, body: { error: "this dispute is not claimable (settled or being settled)" } };

  const { data: jobRow, error: jobErr } = await deps.db.from("jobs")
    .select(`${JOB_COLS}, budget, urgent_fee, helper_id, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents`)
    .eq("id", ag.job_id).maybeSingle();
  if (jobErr || !jobRow) { await markFailed(`job read failed: ${jobErr?.message ?? "missing"}`); return { status: 503, body: { error: "job read failed" } }; }
  const job = jobRow as JobMoneyRow & { budget: number | null; urgent_fee: number | null; helper_id: string | null; helper_fee_flat_cents: number | null; helper_fee_percent: number | null; poster_fee_flat_cents: number | null };
  const found = await readPayPalJobPayment(deps.db, ag.job_id);
  if (found.error || !found.payment) {
    const why = found.error ? `payment read failed: ${found.error}` : "no PayPal payment on this job";
    await markFailed(why);
    return { status: found.error ? 503 : 409, body: { error: why } };
  }
  const payment = found.payment;
  const key = `lh:dispute:${disputeId}:refund`;
  let prior: ClaimRow | null;
  try {
    prior = await existingClaim(deps.db, key);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await markFailed(why);
    return { status: 503, body: { error: why } };
  }
  const rushCents = Math.round(netUrgentFeeDollars(job.urgent_fee) * 100);
  const rushBackCents = partial ? agreedRushRefundCents(rushCents, Number(ag.amount_cents), Number(ag.budget_cents)) : 0;
  let wantCents: number;
  let maxTotal: number | undefined;
  let taxKeptCents = 0;
  if (prior) {
    // A re-run (the remainder failed, or PayPal had not answered): finish THIS dispute's refund at
    // its own amount; never re-price it, never count it against itself (review round 1).
    wantCents = Number(prior.amount_cents);
  } else {
    if (!REFUNDABLE.has(payment.status)) {
      const why = `no refundable PayPal payment (${payment.status})`;
      await markFailed(why);
      return { status: 409, body: { error: why } };
    }
    if (partial && cents(job.sales_tax_amount) > 0) {
      const why = "an agreed part refund on a taxed charge is settled by an admin (as on Stripe, Q1998); nothing was moved";
      await markFailed(why);
      return { status: 409, body: { error: why } };
    }
    if (partial && Number(ag.budget_cents) !== cents(job.budget)) {
      const why = "the agreed refund's price is not this job's price; nothing was moved, an admin settles it";
      await markFailed(why);
      return { status: 409, body: { error: why } };
    }
    let amounts;
    try {
      amounts = await refundableNow(deps, payment, job, null, key);
    } catch (e) {
      const why = `amount unknown: ${e instanceof Error ? e.message : String(e)}`;
      await markFailed(why);
      return { status: 503, body: { error: why } };
    }
    // The poster's part: the agreed amount (+ its rush share), or everything refundable for 'all'.
    wantCents = partial ? Number(ag.amount_cents) + rushBackCents : amounts.remainingCents;
    if (partial && wantCents > amounts.remainingCents) {
      const why = `the agreed refund (${wantCents}c) is more than this payment can return (${amounts.remainingCents}c); nothing was moved, an admin settles it`;
      await markFailed(why);
      return { status: 409, body: { error: why } };
    }
    maxTotal = amounts.ceilingCents;
    taxKeptCents = amounts.taxKeptCents;
  }
  const out = wantCents > 0
    ? await refundProviderPayment(deps.db, deps.provider, {
      paymentId: prior?.provider_payment_id ?? payment.id,
      idempotencyKey: key,
      amountCents: wantCents,
      reason: `agreed refund request (${partial ? "part" : "all"})`,
      noteToPayer: "Your Helpr agreed to refund this job. PayPal keeps its processing fee.",
      maxTotalCents: maxTotal,
    })
    : null;
  if (out) await pageOutcome(deps, "agreement", ag.job_id, out);
  if (out && out.kind !== "refunded") {
    await markFailed(out.kind === "refused" ? `${out.code}: ${out.message}` : out.message);
    return { status: out.kind === "retry" ? 503 : 409, body: { error: out.message } };
  }
  // Never executed (and never a Helpr payout queued) on a refund PayPal has not completed: if it later
  // fails, the poster would hold nothing while the dispute says settled. The next hand-out re-asks.
  if (out && !out.settled) {
    await markFailed(`the poster's refund ${out.providerRefundId} is PENDING at PayPal; settled on a later run`);
    return { status: 409, body: { error: "refund pending at PayPal", pending: true, refunded: out.amountCents } };
  }

  // The Helpr's part (partial only): budget less the agreed amount, plus the rush they keep, less
  // their fee (the job's stamp), rounded down to the dollar.
  let payout: Record<string, unknown> | null = null;
  if (partial) {
    const shareCents = Number(ag.budget_cents) - Number(ag.amount_cents) + (rushCents - rushBackCents);
    const feeCents = helprFlatFeeCents(shareCents, job);
    const helperCents = roundPayoutDownCents(Math.max(0, shareCents - feeCents));
    if (helperCents > 0) {
      const q = await deps.db.rpc("paypal_queue_manual_payout", {
        p_job_id: ag.job_id,
        p_helper_id: ag.helper_id,
        p_amount_cents: helperCents,
        p_platform_fee_cents: feeCents,
        p_initiated_by: "system",
        p_initiated_by_user_id: null,
        p_source: "refund_request_remainder",
      });
      const outcome = (q.data as { outcome?: string; reason?: string } | null)?.outcome ?? null;
      if (q.error || !outcome || !["queued", "queued_held", "already_queued"].includes(outcome)) {
        // PGRST202 (phase 4 not deployed), waiting_for_payee, held, refused: the refund leg is done and
        // replays as a no-op; the remainder is retried on the next hand-out (or by an admin).
        const why = q.error ? `remainder not queued: ${q.error.message}` : `remainder not queued: ${outcome ?? "no answer"}${(q.data as { reason?: string } | null)?.reason ? ` (${(q.data as { reason?: string }).reason})` : ""}`;
        await markFailed(why);
        await deps.alert({ kind: "money_at_risk", severity: "warning", title: "Agreed PayPal refund: the Helpr's part is not queued", message: `Dispute ${disputeId}, job ${ag.job_id}: the poster's part is refunded; ${why}. The next sweep retries.`, oncePerDayKey: `paypal-agreement-remainder:${disputeId}` });
        return { status: 409, body: { error: why, refunded: out?.amountCents ?? 0 } };
      }
      payout = { outcome, amountCents: helperCents, platformFeeCents: feeCents };
    }
  } else {
    const flip = await deps.db.from("jobs").update({ payment_status: "refunded" }).eq("id", ag.job_id).eq("status", "cancelled").select("id");
    if (flip.error || (flip.data ?? []).length === 0) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal agreement refunded, job not marked refunded", message: `Job ${ag.job_id}: ${flip.error?.message ?? "matched no row"}.`, oncePerDayKey: `paypal-agreement-flip:${ag.job_id}` });
    }
  }
  const done = await deps.db.from("disputes").update({
    execution_status: "executed",
    executed_at: new Date().toISOString(),
    execution_refund_id: out?.providerRefundId ?? null,
    execution_refund_cents: out?.amountCents ?? 0,
    execution_helper_cents: Number(payout?.amountCents ?? 0),
    execution_error: null,
  }).eq("id", disputeId).eq("execution_status", "executing").select("id");
  if (done.error || (done.data ?? []).length === 0) {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal agreement settled, dispute not marked executed", message: `Dispute ${disputeId}: ${done.error?.message ?? "matched no row"}. Every leg replays as a no-op.`, oncePerDayKey: `paypal-agreement-mark:${disputeId}` });
  }
  if (out?.kind === "refunded") {
    await tellPayer(deps, job, out, Math.max(0, payment.amount_cents - out.amountCents), taxKeptCents, !partial);
  }
  return { status: 200, body: { settled: true, refundCents: out?.amountCents ?? 0, paypalRefundId: out?.providerRefundId ?? null, payout } };
}
