// PayPal phase 6: the cancel sweep's PayPal leg. A cancelled job still in escrow whose money is
// a PayPal capture (provider_payments) is settled HERE and never reaches the Stripe loop: that
// loop would read "no PaymentIntent, no payment was ever made" and flip it out of escrow with
// the poster's money still held (the reason this split exists).
//
// The rules are the sweep's own (see _shared/payments/paypalCancellation.ts): the same unsettled-
// dispute check (checkUnsettledDispute, fail closed), the same series ban marker and Declutter
// seller-fault reads, then the shared plan. A gift card on a PayPal job is not ported: refused.
// The poster is told what came back and what was kept (sendRefundNotice, as every Stripe refund
// path: Q1714), and the Helpr is told their fee share is on its way.
import { checkUnsettledDispute } from "../_shared/unsettledDispute.ts";
import { settlePayPalCancellation, supabaseCancellationStore, type PayPalCancelJob, type SettleOutcome } from "../_shared/payments/paypalCancellation.ts";
import { rpcManualPayoutQueue } from "../_shared/payments/phase6PayoutDoors.ts";
import { visitSubjectId } from "../_shared/payments/paypalSavedCharge.ts";
import type { PayPalRuntime } from "../_shared/payments/paypalRuntime.ts";
import { refundDollars, refundNoticeProblem, sendRefundNotice } from "../_shared/refundNotice.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const FUNDED = ["captured", "partially_refunded", "disputed", "capture_pending"];
const NOT_DEPLOYED = ["42P01", "42703", "PGRST204", "PGRST205"];

/**
 * Which of these jobs are (or may be) paid through PayPal:
 *   - a funded provider_payments row for the job, or a repeat-visit payment that funds it;
 *   - a series visit with no Stripe payment whose PARENT was paid through PayPal: its visit
 *     payment may have lost its funds_job_id link (lh-money-escrow review of phase 6, #1), and
 *     the Stripe loop would read it as "never paid". The PayPal leg heals the link by subject.
 * `null` = a read failed: the caller lets no job without a Stripe payment through this run.
 */
export async function paypalFundedJobIds(
  db: Db,
  jobs: ReadonlyArray<{ id: string; parent_job_id?: string | null; stripe_payment_intent_id?: string | null; stripe_session_id?: string | null }>,
): Promise<Set<string> | null> {
  if (jobs.length === 0) return new Set();
  const jobIds = jobs.map((j) => j.id);
  const orphanVisits = jobs.filter((j) => j.parent_job_id && !j.stripe_payment_intent_id && !j.stripe_session_id);
  const parents = [...new Set(orphanVisits.map((j) => j.parent_job_id as string))];
  const [own, visit, parentPay] = await Promise.all([
    db.from("provider_payments").select("subject_id").eq("subject_kind", "job").in("subject_id", jobIds).in("status", FUNDED),
    db.from("provider_payments").select("funds_job_id").in("funds_job_id", jobIds).in("status", FUNDED),
    parents.length
      ? db.from("provider_payments").select("subject_id").eq("subject_kind", "job").in("subject_id", parents).not("status", "in", "(created,voided,failed)")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const missing = (e: { code?: string } | null) => !!e && NOT_DEPLOYED.includes(e.code ?? "");
  for (const r of [own, visit, parentPay]) if (r.error && !missing(r.error)) return null;
  const ids = new Set<string>();
  for (const r of (own.data ?? []) as Array<{ subject_id: string }>) ids.add(r.subject_id);
  for (const r of (visit.data ?? []) as Array<{ funds_job_id: string }>) ids.add(r.funds_job_id);
  const paypalParents = new Set(((parentPay.data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id));
  for (const j of orphanVisits) if (paypalParents.has(j.parent_job_id as string)) ids.add(j.id);
  return ids;
}

const JOB_COLS =
  "id, title, customer_id, budget, date_needed, start_time, cancelled_at, helper_id, helper_confirmed_at, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents, customer_fee_amount, onboarding_fee_amount, sales_tax_amount, is_group_job, parent_job_id, recurrence_days, payment_status, status";

export type PayPalCancelResult =
  | (SettleOutcome & { problems?: string[] })
  | { outcome: "skipped"; reason: string; defect: boolean };

/**
 * A series visit whose PayPal payment is not linked to it (a lost funds_job_id write): find the
 * captured visit payment by subject (series + date) and link it. Returns a problem, or null.
 */
async function healVisitLink(db: Db, job: { id: string; parent_job_id: string | null; date_needed: string | null }): Promise<string | null> {
  if (!job.parent_job_id || !job.date_needed) return null;
  const { data: linked, error: lErr } = await db.from("provider_payments").select("id").eq("funds_job_id", job.id).limit(1);
  if (lErr && !NOT_DEPLOYED.includes(lErr.code ?? "")) return `visit link read failed: ${lErr.message}`;
  if ((linked ?? []).length > 0) return null;
  const subject = await visitSubjectId(job.parent_job_id, job.date_needed);
  const { data: pay, error: pErr } = await db
    .from("provider_payments")
    .select("id")
    .eq("subject_kind", "recurring_visit")
    .eq("subject_id", subject)
    .is("funds_job_id", null)
    .in("status", ["captured", "partially_refunded"])
    .limit(1);
  if (pErr) return `visit payment read failed: ${pErr.message}`;
  if (!pay?.[0]) return null;
  const { data: done, error: uErr } = await db.from("provider_payments").update({ funds_job_id: job.id, updated_at: new Date().toISOString() }).eq("id", pay[0].id).is("funds_job_id", null).select("id");
  if (uErr || !done || done.length === 0) return `visit payment ${pay[0].id} not linked to ${job.id}: ${uErr?.message ?? "zero rows"}`;
  console.warn(`[void-cancelled-payments] healed a lost visit link: payment ${pay[0].id} -> visit ${job.id}`);
  return null;
}

export async function settlePayPalCancelledJob(db: Db, jobId: string, runtime: PayPalRuntime): Promise<PayPalCancelResult> {
  if (!runtime.ok) return { outcome: "skipped", reason: `paypal_not_configured: ${runtime.reason}`, defect: true };

  const settlement = await checkUnsettledDispute(db, jobId);
  if (settlement.blocked) {
    return settlement.readError
      ? { outcome: "skipped", reason: `dispute_check_failed: ${settlement.readError}`, defect: true }
      : { outcome: "skipped", reason: "dispute_decision_pending", defect: false };
  }

  const { data: job, error: jobErr } = await db.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
  if (jobErr || !job) return { outcome: "skipped", reason: `job_read_failed: ${jobErr?.message ?? "no row"}`, defect: true };
  if (job.status !== "cancelled" || job.payment_status !== "escrow") return { outcome: "skipped", reason: "no_longer_cancelled_escrow", defect: false };

  // Series ban marker (read apart, as the Stripe loop does: 42703 = "not ban-ended").
  let seriesBan: string | null = null;
  if (job.parent_job_id || (Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0)) {
    const { data: m, error: mErr } = await db.from("jobs").select("series_ban_cancelled_at").eq("id", jobId).maybeSingle();
    if (mErr && mErr.code !== "42703") return { outcome: "skipped", reason: `series_marker_read_failed: ${mErr.message}`, defect: true };
    seriesBan = mErr ? null : (m?.series_ban_cancelled_at ?? null);
  }

  // A10: a Declutter seller's backing out (only a missing table/column reads "not marked").
  const { data: fault, error: faultErr } = await db.from("declutter_order_jobs").select("seller_fault_refund_id").eq("job_id", jobId).maybeSingle();
  const faultNotDeployed = !!faultErr && NOT_DEPLOYED.includes(faultErr.code ?? "");
  if (faultErr && !faultNotDeployed) return { outcome: "skipped", reason: `seller_fault_read_failed: ${faultErr.message}`, defect: true };
  const sellerFault = !faultErr && !!fault?.seller_fault_refund_id;

  // A gift card on this job: the gift leg is Stripe-era only. Refuse; a person settles it.
  const { data: gifts, error: giftErr } = await db.from("gift_cards").select("id").eq("job_id", jobId).in("status", ["reserved", "redeemed"]).limit(1);
  if (giftErr) return { outcome: "skipped", reason: `gift_read_failed: ${giftErr.message}`, defect: true };
  if ((gifts ?? []).length > 0) return { outcome: "needs_review", reason: "gift_card_on_paypal_job_not_ported" };

  const healProblem = await healVisitLink(db, job);
  if (healProblem) return { outcome: "skipped", reason: healProblem, defect: true };

  const pj: PayPalCancelJob = { ...job, series_ban_cancelled_at: seriesBan };
  let out: SettleOutcome;
  try {
    out = await settlePayPalCancellation(
      {
        store: supabaseCancellationStore(db),
        provider: runtime.provider,
        readCaptureFeeCents: runtime.readCaptureFeeCents,
        queue: rpcManualPayoutQueue(db),
        env: runtime.env,
      },
      pj,
      sellerFault,
    );
  } catch (e) {
    // A database refusal or read failure mid-settlement (e.g. refund_after_payout_queued): what
    // was recorded stays recorded, nothing else moves for this job, and one job never stops the
    // run. A person looks (the caller pages on needs_review).
    return { outcome: "needs_review", reason: `settlement_threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
  if (out.outcome !== "settled") return out;
  return { ...out, problems: await tellTheParties(db, pj, out, runtime.env) };
}

/** The poster: what came back and what was kept. The Helpr: their fee share is on its way. */
async function tellTheParties(db: Db, job: PayPalCancelJob, out: Extract<SettleOutcome, { outcome: "settled" }>, env: string): Promise<string[]> {
  const problems: string[] = [];
  const p = out.plan;
  if (p.refundCents > 0 && out.providerRefundId) {
    const kept = p.feeCents + p.providerFeeKeptCents + p.setupFeeKeptCents + p.taxKeptCents;
    const why = [
      p.feeCents > 0 ? `the ${p.feePercent}% late-cancellation fee your Helpr is paid` : null,
      p.providerFeeKeptCents > 0 ? "PayPal's processing fee, which PayPal does not return" : null,
    ].filter(Boolean).join(" and ");
    const r = await sendRefundNotice(db, {
      key: `refund:pp_${out.providerRefundId}`,
      kind: "refund",
      paymentIntentId: null,
      jobByPayment: false,
      amountCents: p.refundCents,
      keptCents: kept,
      keptReason: why || null,
      taxKeptCents: p.taxKeptCents,
      recipientId: job.customer_id ?? null,
      jobId: job.id,
      method: { type: "paypal" },
      testMode: env === "sandbox",
    });
    const problem = refundNoticeProblem(r);
    if (problem) problems.push(`refund notice ${job.id} (${refundDollars(p.refundCents)}): ${problem}`);
  }
  if (p.helprPayoutCents > 0 && job.helper_id) {
    const { data, error } = await db.from("notifications").insert({
      user_id: job.helper_id,
      job_id: job.id,
      title: "You're getting a cancellation fee",
      message: `The poster cancelled late, so ${refundDollars(p.helprPayoutCents)} of the cancellation fee is yours. It's sent to your PayPal.`,
      type: "payment",
      link: `/jobs?job=${job.id}`,
    }).select("id");
    if (error || !data || data.length === 0) problems.push(`helpr fee notice ${job.id}: ${error?.message ?? "zero rows"}`);
  }
  for (const pr of problems) console.error(`[void-cancelled-payments] ${pr}`);
  return problems;
}
