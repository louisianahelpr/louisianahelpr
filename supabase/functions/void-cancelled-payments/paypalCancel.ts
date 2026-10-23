// PayPal phase 6: the cancel sweep's PayPal leg. A cancelled job still in escrow whose money is
// a PayPal capture (provider_payments) is settled HERE and never reaches the Stripe loop: that
// loop would read "no PaymentIntent, no payment was ever made" and flip it out of escrow with
// the poster's money still held (the reason this split exists).
//
// The rules are the sweep's own (see _shared/payments/paypalCancellation.ts): the same unsettled-
// dispute check (checkUnsettledDispute, fail closed), the same series ban marker and Declutter
// seller-fault reads, then the shared plan. A gift card on a PayPal job is not ported: refused.
import { checkUnsettledDispute } from "../_shared/unsettledDispute.ts";
import { settlePayPalCancellation, supabaseCancellationStore, type PayPalCancelJob, type SettleOutcome } from "../_shared/payments/paypalCancellation.ts";
import { rpcManualPayoutQueue } from "../_shared/payments/manualPayoutQueue.ts";
import type { PayPalRuntime } from "../_shared/payments/paypalRuntime.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const FUNDED = ["captured", "partially_refunded", "disputed", "capture_pending"];

/**
 * Which of these job ids are paid through PayPal (a funded provider_payments row for the job,
 * or a repeat-visit payment that funds it). `null` = the read failed: the caller must not let
 * any job without a Stripe payment through to the Stripe loop this run.
 */
export async function paypalFundedJobIds(db: Db, jobIds: readonly string[]): Promise<Set<string> | null> {
  if (jobIds.length === 0) return new Set();
  const [own, visit] = await Promise.all([
    db.from("provider_payments").select("subject_id").eq("subject_kind", "job").in("subject_id", jobIds).in("status", FUNDED),
    db.from("provider_payments").select("funds_job_id").in("funds_job_id", jobIds).in("status", FUNDED),
  ]);
  // A missing column/table (this function deployed before the phase 6 migration) reads "none".
  const missing = (e: { code?: string } | null) => !!e && ["42P01", "42703", "PGRST204", "PGRST205"].includes(e.code ?? "");
  if ((own.error && !missing(own.error)) || (visit.error && !missing(visit.error))) return null;
  const ids = new Set<string>();
  for (const r of (own.data ?? []) as Array<{ subject_id: string }>) ids.add(r.subject_id);
  for (const r of (visit.data ?? []) as Array<{ funds_job_id: string }>) ids.add(r.funds_job_id);
  return ids;
}

const JOB_COLS =
  "id, title, customer_id, budget, date_needed, start_time, cancelled_at, helper_id, helper_confirmed_at, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents, customer_fee_amount, onboarding_fee_amount, sales_tax_amount, is_group_job, parent_job_id, recurrence_days, payment_status, status";

export type PayPalCancelResult = SettleOutcome | { outcome: "skipped"; reason: string; defect: boolean };

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
  const faultNotDeployed = !!faultErr && ["42P01", "42703", "PGRST204", "PGRST205"].includes(faultErr.code ?? "");
  if (faultErr && !faultNotDeployed) return { outcome: "skipped", reason: `seller_fault_read_failed: ${faultErr.message}`, defect: true };
  const sellerFault = !faultErr && !!fault?.seller_fault_refund_id;

  // A gift card on this job: the gift leg is Stripe-era only. Refuse; a person settles it.
  const { data: gifts, error: giftErr } = await db.from("gift_cards").select("id").eq("job_id", jobId).in("status", ["reserved", "redeemed"]).limit(1);
  if (giftErr) return { outcome: "skipped", reason: `gift_read_failed: ${giftErr.message}`, defect: true };
  if ((gifts ?? []).length > 0) return { outcome: "needs_review", reason: "gift_card_on_paypal_job_not_ported" };

  const pj: PayPalCancelJob = { ...job, series_ban_cancelled_at: seriesBan };
  return await settlePayPalCancellation(
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
}
