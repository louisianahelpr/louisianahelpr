/**
 * Job-level PayPal refunds (PayPal Plan A, phase 5; design §6 row 5): the three doors that give a
 * poster money back on a job paid through PayPal, each through refundProviderPayment (claim first,
 * one key per business event, the database refusing once a payout is queued).
 *
 *   refundCancelledJob       a poster cancelled before the work (poster_cancel_job): fee 0 only.
 *                            A late-cancel fee (25/50%), a crew or a series waits for phase 6 and
 *                            pages ops once a day; the money stays held, never half-refunded.
 *   adminRefundPayPalJob     an admin's refund, full (the job is cancelled) or partial.
 *   settleRefundAgreement    an agreed refund request (Board 141). Phase 5 settles a FULL agreement;
 *                            a partial one needs phase 4's payout queue for the Helpr's part and is
 *                            refused with "needs phase 4" until then (lead, 2026-10-23).
 *
 * WHAT A REFUND KEEPS (owner 2026-10-14: "if admin refunds we keep the fee also. we should never
 * absorb any fee"): PayPal keeps its processing fee on every refund (sandbox 2026-10-23: refund
 * paypal_fee 0.00, the capture's fee not returned), so every refund here returns what was paid less
 * PayPal's real fee on that capture (read from PayPal, never estimated), less a first job's setup
 * fee and the tax on what is kept: _shared/refundAmount.ts refundToPayerCents, the same rule as
 * Stripe's paths.
 *
 * isPayPalFundedJob is the one predicate every Stripe-era money path uses to keep its hands off a
 * PayPal job (void-cancelled-payments Part A, create-payment's refund doors, execute-dispute-split,
 * refund-request-sweep): to those paths a PayPal job has no PaymentIntent and would read as "no
 * money was ever taken" (src/test/stripePathsSkipPayPalJobs.test.ts).
 */
import { refundToPayerCents } from "../refundAmount.ts";
import { refundNoticeProblem, sendRefundNotice } from "../refundNotice.ts";
import type { PayPalClient } from "./paypalClient.ts";
import { readCapture } from "./paypalReads.ts";
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
}

/** The PayPal payment on a job, or null for a Stripe-era / unpaid job. Fails CLOSED: an error is returned, never "none". */
export async function readPayPalJobPayment(db: { from: (t: string) => any }, jobId: string): Promise<{ payment: PayPalJobPayment | null; error: string | null }> {
  const { data, error } = await db.from("provider_payments")
    .select("id, status, amount_cents, provider_capture_id, env")
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
}
const JOB_COLS = "id, title, status, payment_status, customer_id, customer_fee_amount, onboarding_fee_amount, sales_tax_amount";

const cents = (dollars: number | null | undefined) => Math.max(0, Math.round(Number(dollars ?? 0) * 100));

async function liveRefundedCents(db: Db, paymentId: string): Promise<number> {
  const { data, error } = await db.from("provider_refunds").select("amount_cents")
    .eq("provider_payment_id", paymentId).in("status", ["pending", "completed"]);
  if (error) throw new Error(`refund total read failed: ${error.message}`);
  return ((data ?? []) as Array<{ amount_cents: number }>).reduce((s, r) => s + Number(r.amount_cents), 0);
}

/** How much may go back now: captured less PayPal's fee, setup fee, the tax on them and earlier refunds. */
export async function refundableNow(deps: JobRefundDeps, payment: PayPalJobPayment, job: JobMoneyRow, requestedCents: number | null) {
  if (!payment.provider_capture_id) throw new Error("payment has no capture");
  const cap = await readCapture(deps.client, payment.provider_capture_id);
  if (cap.amountCents !== payment.amount_cents) throw new Error(`capture ${cap.id} is ${cap.amountCents} cents, our row says ${payment.amount_cents}`);
  if (cap.feeCents === null) throw new Error(`capture ${cap.id} has no PayPal fee yet; refund later`);
  const already = await liveRefundedCents(deps.db, payment.id);
  return refundToPayerCents({
    capturedCents: payment.amount_cents,
    actualFeeCents: cap.feeCents,
    customerFeeCents: cents(job.customer_fee_amount),
    setupFeeCents: cents(job.onboarding_fee_amount),
    taxCents: cents(job.sales_tax_amount),
    alreadyRefundedCents: already,
    requestedCents,
  });
}

/** keptIsFee: what the payment kept is PayPal's fee (and the tax on it), not money a partial refund left. */
async function tellPayer(deps: JobRefundDeps, job: JobMoneyRow, out: Extract<RefundOutcome, { kind: "refunded" }>, keptCents: number, taxKeptCents: number, keptIsFee: boolean) {
  if (out.replay) return; // told by the run that made it
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
  if (out.kind === "recorded_late") {
    await deps.alert({
      kind: "money_at_risk", severity: "critical", title: "PayPal refund made but not recorded",
      message: `${where} job ${jobId}: PayPal refunded ${out.amountCents} cents (${out.providerRefundId}) but provider_refunds did not take it: ${out.message}. PAYMENT.CAPTURE.REFUNDED will attach it; check the row.`,
      fields: { job_id: jobId, refund_row: out.refundRowId, paypal_refund: out.providerRefundId },
    });
  } else if (out.kind === "retry") {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund not finished", message: `${where} job ${jobId}: ${out.message.slice(0, 300)}. The next run retries with the same key.`, oncePerDayKey: `paypal-refund-retry:${where}:${jobId}` });
  } else if (out.kind === "refused" && out.code !== "refund_after_payout_queued") {
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
}

export const cancelRefundKey = (jobId: string) => `lh:job:${jobId}:refund:cancel`;

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
  const { data: job, error: jobErr } = await deps.db.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
  if (jobErr || !job) return `job_read_failed:${jobErr?.message ?? "missing"}`;
  if ((job as JobMoneyRow).status !== "cancelled") return "no_longer_cancelled";
  const { data: payRow, error: payErr } = await deps.db.from("provider_payments")
    .select("id, status, amount_cents, provider_capture_id, env").eq("id", due.provider_payment_id).maybeSingle();
  if (payErr || !payRow) return `payment_read_failed:${payErr?.message ?? "missing"}`;
  const payment = payRow as PayPalJobPayment;
  if (!REFUNDABLE.has(payment.status)) return `not_refundable:${payment.status}`;
  let amounts;
  try {
    amounts = await refundableNow(deps, payment, job as JobMoneyRow, null);
  } catch (e) {
    return `amount_unknown:${e instanceof Error ? e.message : String(e)}`;
  }
  if (amounts.refundCents <= 0) return "nothing_refundable";
  const out = await refundProviderPayment(deps.db, deps.provider, {
    paymentId: payment.id,
    idempotencyKey: cancelRefundKey(jobId),
    amountCents: amounts.refundCents,
    reason: "poster cancelled before the work; no cancellation fee",
    noteToPayer: "Your Louisiana Helpr job was cancelled. PayPal keeps its processing fee.",
  });
  return await afterCancelRefund(deps, job as JobMoneyRow, out, payment.amount_cents, amounts.taxKeptCents);
}

async function afterCancelRefund(deps: JobRefundDeps, job: JobMoneyRow, out: RefundOutcome, capturedCents: number, taxKeptCents = 0): Promise<string> {
  await pageOutcome(deps, "cancel", job.id, out);
  if (out.kind !== "refunded") return out.kind === "refused" ? `refused:${out.code}` : out.kind;
  // The job's money is settled: pinned to the state read, so a job that moved in between keeps its own.
  const flip = await deps.db.from("jobs").update({ payment_status: "refunded" })
    .eq("id", job.id).eq("status", "cancelled")
    .filter("payment_status", job.payment_status == null ? "is" : "eq", job.payment_status ?? null)
    .select("id");
  if (flip.error || (flip.data ?? []).length === 0) {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal refund made, job not marked refunded", message: `Job ${job.id}: refunded ${out.amountCents} cents (${out.providerRefundId}) but the job flip ${flip.error ? `failed: ${flip.error.message}` : "matched no row (the job moved)"}.`, oncePerDayKey: `paypal-cancel-flip:${job.id}` });
  }
  await tellPayer(deps, job, out, Math.max(0, capturedCents - out.amountCents), taxKeptCents, true);
  return out.replay ? "already_refunded" : "refunded";
}

/** A claim whose PayPal answer was lost (pending, no PayPal id): ask again with the SAME key. */
export async function retryLostRefunds(deps: JobRefundDeps, now = Date.now()): Promise<{ retried: number; finished: number; stale: number }> {
  const { data, error } = await deps.db.from("provider_refunds")
    .select("id, provider_payment_id, idempotency_key, amount_cents, created_at")
    .eq("status", "pending").is("provider_refund_id", null)
    .lt("created_at", new Date(now - 2 * 60_000).toISOString())
    .like("idempotency_key", "lh:%")
    .limit(20);
  if (error) throw new Error(`lost-refund read failed: ${error.message}`);
  let retried = 0, finished = 0, stale = 0;
  for (const row of (data ?? []) as Array<{ id: string; provider_payment_id: string; idempotency_key: string; amount_cents: number; created_at: string }>) {
    // PayPal answers a reused PayPal-Request-Id with the original object; how long it remembers one
    // is not on the pages read (ASSUMED: hours). Past an hour a human checks PayPal first.
    if (now - Date.parse(row.created_at) > 60 * 60_000) {
      stale++;
      await deps.alert({ kind: "money_at_risk", severity: "critical", title: "PayPal refund unanswered for over an hour", message: `provider_refunds ${row.id} (${row.idempotency_key}, ${row.amount_cents} cents) has no PayPal answer. Check PayPal's activity for this capture before retrying by hand.`, oncePerDayKey: `paypal-refund-stale:${row.id}` });
      continue;
    }
    retried++;
    const out = await refundProviderPayment(deps.db, deps.provider, { paymentId: row.provider_payment_id, idempotencyKey: row.idempotency_key, amountCents: Number(row.amount_cents), reason: "retry" });
    if (out.kind === "refunded") finished++;
    // A finished cancel refund also settles its job and tells the poster; any other key pages only.
    const m = /^lh:job:([0-9a-f-]{36}):refund:cancel$/.exec(row.idempotency_key);
    if (m) {
      const { data: job } = await deps.db.from("jobs").select(JOB_COLS).eq("id", m[1]).maybeSingle();
      const { data: pay } = await deps.db.from("provider_payments").select("amount_cents").eq("id", row.provider_payment_id).maybeSingle();
      if (job && pay) await afterCancelRefund(deps, job as JobMoneyRow, out, Number((pay as { amount_cents: number }).amount_cents));
    } else {
      await pageOutcome(deps, "retry", row.idempotency_key, out);
    }
  }
  return { retried, finished, stale };
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
  if (!payment || !REFUNDABLE.has(payment.status)) {
    return { status: 409, body: { error: payment ? `This PayPal payment is ${payment.status.replace(/_/g, " ")}, so nothing more can be refunded here.` : "This job has no PayPal payment to refund." } };
  }
  let amounts;
  try {
    amounts = await refundableNow(deps, payment, j, input.amountCents ?? null);
  } catch (e) {
    return { status: 503, body: { error: `Couldn't work out the refundable amount from PayPal (${e instanceof Error ? e.message : String(e)}). No money was moved.` } };
  }
  if (amounts.refundCents <= 0) {
    return { status: 409, body: { error: "Nothing is left to refund: PayPal's processing fee and earlier refunds take the rest.", remainingCents: amounts.remainingCents } };
  }
  if (input.amountCents != null && input.amountCents > amounts.remainingCents) {
    return { status: 409, body: { error: `At most ${amounts.remainingCents} cents can go back (PayPal keeps its processing fee). No money was moved.`, remainingCents: amounts.remainingCents } };
  }
  const full = input.amountCents == null;
  const out = await refundProviderPayment(deps.db, deps.provider, {
    paymentId: payment.id,
    idempotencyKey: `lh:job:${j.id}:refund:admin:${input.requestId.toLowerCase()}`,
    amountCents: amounts.refundCents,
    reason: `admin ${input.adminId}: ${input.reason}`.slice(0, 500),
    noteToPayer: "Refund from Louisiana Helpr. PayPal keeps its processing fee.",
  });
  await pageOutcome(deps, "admin", j.id, out);
  if (out.kind === "refused") {
    const why = out.code === "refund_after_payout_queued"
      ? "A payout of this job to the Helpr is queued or sent, so it can't be refunded here. Cancel the payout first."
      : out.code === "refund_exceeds_payment" ? "That is more than is left on this payment." : `PayPal or the ledger refused it (${out.code}).`;
    return { status: 409, body: { error: `${why} No money was moved.`, code: out.code } };
  }
  if (out.kind === "retry") return { status: 503, body: { error: "PayPal did not answer. Press again: the same refund is retried, never doubled.", retry: true } };
  if (out.kind === "recorded_late") return { status: 500, body: { error: "PayPal refunded it, but our ledger is behind. Ops has been paged.", paypalRefundId: out.providerRefundId } };
  if (full) {
    // A full admin refund cancels the job, as admin_refund_general does on Stripe.
    const flip = await deps.db.from("jobs").update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", j.id).neq("status", "disputed").select("id");
    if (flip.error || (flip.data ?? []).length === 0) {
      await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal admin refund made, job not cancelled", message: `Job ${j.id}: ${flip.error?.message ?? "matched no row"}.`, oncePerDayKey: `paypal-admin-flip:${j.id}` });
    }
  }
  // Kept = the payment less every refund so far (earlier ones are ceiling - remaining).
  const alreadyBefore = amounts.ceilingCents - amounts.remainingCents;
  await tellPayer(deps, j, out, Math.max(0, payment.amount_cents - alreadyBefore - out.amountCents), amounts.taxKeptCents, full);
  return { status: 200, body: { refunded: true, amountCents: out.amountCents, paypalRefundId: out.providerRefundId, settled: out.settled, replay: out.replay, full } };
}

/** An agreed refund request (Board 141) on a PayPal job. Service only. */
export async function settleRefundAgreement(deps: JobRefundDeps, disputeId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const proof = await deps.db.rpc("refund_agreement_for_dispute", { p_dispute_id: disputeId });
  if (proof.error) return { status: 503, body: { error: `agreement read failed: ${proof.error.message}` } };
  const ag = proof.data as { job_id?: string; amount_cents?: number; budget_cents?: number } | null;
  if (!ag?.job_id) return { status: 409, body: { error: "no recorded agreement for this dispute" } };
  const markFailed = async (why: string) => {
    await deps.db.from("disputes").update({ execution_status: "failed", execution_error: why.slice(0, 500) })
      .eq("id", disputeId).eq("execution_status", "executing").select("id");
  };
  if (Number(ag.amount_cents) !== Number(ag.budget_cents)) {
    // A partial agreement pays the Helpr the rest through phase 4's queue (paypal_queue_manual_payout).
    return { status: 409, body: { error: "needs phase 4: a partial refund agreement on a PayPal job waits for the Helpr payout queue", partial: true } };
  }
  // Claim the dispute's execution (one settler at a time; a failed run is claimable again).
  const claim = await deps.db.from("disputes").update({ execution_status: "executing", execution_started_at: new Date().toISOString() })
    .eq("id", disputeId).eq("status", "decided").or("execution_status.is.null,execution_status.in.(pending,failed)")
    .is("execution_refund_id", null).select("id");
  if (claim.error) return { status: 503, body: { error: `claim failed: ${claim.error.message}` } };
  if ((claim.data ?? []).length === 0) return { status: 409, body: { error: "this dispute is not claimable (settled or being settled)" } };
  const { data: job, error: jobErr } = await deps.db.from("jobs").select(JOB_COLS).eq("id", ag.job_id).maybeSingle();
  if (jobErr || !job) { await markFailed(`job read failed: ${jobErr?.message ?? "missing"}`); return { status: 503, body: { error: "job read failed" } }; }
  const found = await readPayPalJobPayment(deps.db, ag.job_id);
  if (found.error || !found.payment || !REFUNDABLE.has(found.payment.status)) {
    const why = found.error ? `payment read failed: ${found.error}` : `no refundable PayPal payment (${found.payment?.status ?? "none"})`;
    await markFailed(why);
    return { status: found.error ? 503 : 409, body: { error: why } };
  }
  let amounts;
  try {
    amounts = await refundableNow(deps, found.payment, job as JobMoneyRow, null);
  } catch (e) {
    const why = `amount unknown: ${e instanceof Error ? e.message : String(e)}`;
    await markFailed(why);
    return { status: 503, body: { error: why } };
  }
  const out = amounts.refundCents > 0
    ? await refundProviderPayment(deps.db, deps.provider, {
      paymentId: found.payment.id,
      idempotencyKey: `lh:dispute:${disputeId}:refund`,
      amountCents: amounts.refundCents,
      reason: "agreed refund request (all)",
      noteToPayer: "Your Helpr agreed to refund this job. PayPal keeps its processing fee.",
    })
    : null;
  if (out) await pageOutcome(deps, "agreement", ag.job_id, out);
  if (out && out.kind !== "refunded") {
    await markFailed(out.kind === "refused" ? `${out.code}: ${out.message}` : out.message);
    return { status: out.kind === "retry" ? 503 : 409, body: { error: out.message } };
  }
  await deps.db.from("jobs").update({ payment_status: "refunded" }).eq("id", ag.job_id).eq("status", "cancelled").select("id");
  const done = await deps.db.from("disputes").update({
    execution_status: "executed",
    executed_at: new Date().toISOString(),
    execution_refund_id: out?.providerRefundId ?? null,
    execution_refund_cents: out?.amountCents ?? 0,
    execution_helper_cents: 0,
    execution_error: null,
  }).eq("id", disputeId).eq("execution_status", "executing").select("id");
  if (done.error || (done.data ?? []).length === 0) {
    await deps.alert({ kind: "money_at_risk", severity: "warning", title: "PayPal agreement refunded, dispute not marked executed", message: `Dispute ${disputeId}: ${done.error?.message ?? "matched no row"}. The refund key makes a re-run a no-op.`, oncePerDayKey: `paypal-agreement-mark:${disputeId}` });
  }
  if (out?.kind === "refunded") await tellPayer(deps, job as JobMoneyRow, out, Math.max(0, found.payment.amount_cents - out.amountCents), amounts.taxKeptCents, true);
  return { status: 200, body: { settled: true, refundCents: out?.amountCents ?? 0, paypalRefundId: out?.providerRefundId ?? null } };
}
