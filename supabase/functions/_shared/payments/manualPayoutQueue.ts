/**
 * The manual PayPal payout leg (PayPal Plan A, phase 4; design ~/.lh-wt/paypal-design.md section 6).
 *
 * Live PayPal Payouts was denied (owner 2026-10-23), so a Helpr paid through PayPal is paid BY HAND:
 * on approval the job lands in the admin "Pay this Helpr" queue, the owner sends the money with PayPal
 * Send Money, then presses "Mark paid" with PayPal's transaction id (admin_mark_paypal_payout_paid).
 *
 * This module is the ONE way a release path puts a PayPal job in that queue. It:
 *   - tells a PayPal-paid job from a Stripe one (`jobPaypalPayment` / `paypalJobIds`): a job is PayPal's
 *     when it has a provider_payments row past created/voided/failed (phase 3's job_provider_payment_held
 *     rule; an abandoned PayPal order on a job the poster then paid by card is NOT PayPal's), and no
 *     Stripe payout path may pay it (a Stripe transfer would pay the Helpr out of money that is not in
 *     Stripe, on top of the manual payout). Unreadable means "do not pay it through Stripe" (fail closed).
 *   - computes the Helpr's share with the SAME helpers release-payout uses, and
 *   - calls public.paypal_queue_manual_payout(), which writes the payout_transfers claim and the
 *     provider_payouts row in one transaction and is idempotent per (job, Helpr).
 *
 * Not deducted here (lead decision 2026-10-23): the one-time onboarding fee and the Helpr-fault card
 * fee. Both are Stripe-era claim/rollback flows; the fee phase can add them.
 *
 * Nothing here calls PayPal: the manual leg has no API (registry.payoutProviderFor("manual_paypal")
 * throws on purpose).
 */
import { DEFAULT_TIER_FEE_PERCENT, getHelperFeePercent, jobHelprCommissionDollars } from "../helperFees.ts";
import { flatFeePercentOf } from "../helprFlatFee.ts";
import { roundPayoutDownCents } from "../money.ts";
import { netUrgentFeeDollars } from "../stripeFees.ts";
import { insertNotifications } from "../insertNotifications.ts";

/** provider_payments statuses that do NOT make a job PayPal's (an order never paid). */
const NOT_PAYPAL_YET = "(created,voided,failed)";

// deno-lint-ignore no-explicit-any
type AdminClient = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type JobPaypalPayment =
  | { kind: "paypal"; paymentId: string; env: string; status: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

/** Is this job paid through PayPal? A read error is "error": the caller must not pay it through Stripe. */
export async function jobPaypalPayment(admin: AdminClient, jobId: string): Promise<JobPaypalPayment> {
  const { data, error } = await admin
    .from("provider_payments")
    .select("id, env, status")
    .eq("subject_kind", "job")
    .eq("subject_id", jobId)
    .not("status", "in", NOT_PAYPAL_YET)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { kind: "error", message: String(error.message ?? error) };
  const row = (data ?? [])[0] as { id: string; env: string; status: string } | undefined;
  return row ? { kind: "paypal", paymentId: row.id, env: row.env, status: row.status } : { kind: "none" };
}

/** The subset of `jobIds` paid through PayPal, in one read. `ok: false` means none may be paid through Stripe. */
export async function paypalJobIds(
  admin: AdminClient,
  jobIds: readonly string[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; message: string }> {
  if (jobIds.length === 0) return { ok: true, ids: new Set() };
  const { data, error } = await admin
    .from("provider_payments")
    .select("subject_id")
    .eq("subject_kind", "job")
    .in("subject_id", [...jobIds])
    .not("status", "in", NOT_PAYPAL_YET);
  if (error) return { ok: false, message: String(error.message ?? error) };
  return { ok: true, ids: new Set(((data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)) };
}

/** The job columns the share is computed from (the same ones release-payout reads). */
export interface PayoutJobFields {
  id: string;
  helper_id: string | null;
  budget: number | string | null;
  urgent_fee: number | string | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  helper_fee_percent: number | string | null;
  helper_fee_flat_cents: number | string | null;
  poster_fee_flat_cents?: number | string | null;
}

export const PAYOUT_JOB_COLUMNS =
  "id, helper_id, budget, urgent_fee, is_group_job, helpers_needed, helper_fee_percent, helper_fee_flat_cents, poster_fee_flat_cents";

/**
 * The Helpr's share and our fee, in cents: release-payout's math (per-Helpr budget + urgent bonus,
 * minus the job's commission model, rounded down to the cent).
 */
export function manualPayoutCents(job: PayoutJobFields, helperFeePercent: number): { payoutCents: number; platformFeeCents: number } {
  const helpers = job.is_group_job && job.helpers_needed && job.helpers_needed > 0 ? job.helpers_needed : 1;
  const perHelperBudget = Number(job.budget ?? 0) / helpers;
  const perHelperUrgent = netUrgentFeeDollars(job.urgent_fee === null ? null : Number(job.urgent_fee)) / helpers;
  const commission = jobHelprCommissionDollars(
    job as Parameters<typeof jobHelprCommissionDollars>[0],
    perHelperBudget,
    helperFeePercent,
    perHelperUrgent,
  );
  return {
    payoutCents: roundPayoutDownCents(Math.round((perHelperBudget + perHelperUrgent - commission) * 100)),
    platformFeeCents: Math.round(commission * 100),
  };
}

export type QueueOutcome =
  /** queued_held: written, but held until an admin checks a PayPal email changed after the job's approval. */
  | { outcome: "queued" | "queued_held" | "already_queued"; payout_id?: string; payout_transfer_id?: string; amount_cents?: number; reason?: string }
  | { outcome: "waiting_for_payee" | "held" | "refused"; reason: string }
  | { outcome: "error"; message: string };

/** Put one PayPal-paid, approved job in the admin pay queue. Never throws. */
export async function queueManualPaypalPayout(
  admin: AdminClient,
  opts: {
    jobId: string;
    initiatedBy: "system" | "admin" | "auto";
    initiatedByUserId?: string | null;
    source: string;
    /**
     * Required for a PART of the payment (refund_request_remainder, cancellation_fee): the agreed
     * amount. Without it this helper would queue the FULL job share (lh-money-escrow re-review).
     */
    amountCents?: number;
    platformFeeCents?: number;
  },
): Promise<QueueOutcome> {
  if ((opts.source === "refund_request_remainder" || opts.source === "cancellation_fee")
      && !(Number.isInteger(opts.amountCents) && (opts.amountCents as number) > 0)) {
    return { outcome: "refused", reason: "amount_required" };
  }
  try {
    const { data: job, error: jobErr } = await admin.from("jobs").select(PAYOUT_JOB_COLUMNS).eq("id", opts.jobId).maybeSingle();
    if (jobErr) return { outcome: "error", message: `job read failed: ${jobErr.message ?? jobErr}` };
    if (!job) return { outcome: "refused", reason: "job_not_found" };
    const j = job as PayoutJobFields;
    if (!j.helper_id) return { outcome: "refused", reason: "job_has_no_helpr" };
    const frozen = j.helper_fee_percent === null || j.helper_fee_percent === undefined ? null : Number(j.helper_fee_percent);
    const percent = flatFeePercentOf(j as Parameters<typeof flatFeePercentOf>[0]) ?? await getHelperFeePercent(
      admin,
      j.helper_id,
      frozen !== null && Number.isFinite(frozen) ? frozen : DEFAULT_TIER_FEE_PERCENT,
    );
    const computed = manualPayoutCents(j, percent);
    const payoutCents = opts.amountCents ?? computed.payoutCents;
    const platformFeeCents = opts.amountCents !== undefined ? (opts.platformFeeCents ?? 0) : computed.platformFeeCents;
    if (!(payoutCents > 0)) return { outcome: "refused", reason: "computed_payout_not_positive" };
    const { data, error } = await admin.rpc("paypal_queue_manual_payout", {
      p_job_id: j.id,
      p_helper_id: j.helper_id,
      p_amount_cents: payoutCents,
      p_platform_fee_cents: platformFeeCents,
      p_initiated_by: opts.initiatedBy,
      p_initiated_by_user_id: opts.initiatedByUserId ?? null,
      p_source: opts.source,
    });
    if (error) return { outcome: "error", message: `paypal_queue_manual_payout failed: ${error.message ?? error}` };
    const out = (data ?? null) as QueueOutcome | null;
    if (!out || typeof out !== "object" || !("outcome" in out)) {
      return { outcome: "error", message: `paypal_queue_manual_payout answered ${JSON.stringify(data)}` };
    }
    return out;
  } catch (e) {
    return { outcome: "error", message: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Outcomes a cron should NOT raise as a defect: waiting on the Helpr's email or a hold is a state the
 * admin queue shows; an admin's own cancel and a crew job (Q2377) are listed there too. Every other
 * refusal (a dispute, an amount over the payment, a stray claim) is a defect someone must look at.
 */
export function isExpectedWait(o: QueueOutcome): boolean {
  if (o.outcome === "waiting_for_payee" || o.outcome === "held") return true;
  return o.outcome === "refused" && (o.reason === "canceled_by_admin" || o.reason === "crew_not_supported");
}

export const ADD_PAYPAL_EMAIL_TITLE = "Add your PayPal email to get paid";

/**
 * A PayPal job approved for a Helpr with no PayPal email that can be paid (outcome waiting_for_payee):
 * tell them what to do, at most once a day per job (the crons retry hourly). Never the Stripe
 * "Payout account required" notice: a PayPal job is paid to a PayPal email (phase 2 review).
 * Never throws; a failed read or write is returned for the caller to count.
 */
export async function tellPayeeToAddPaypalEmail(
  admin: AdminClient,
  job: { id: string; title?: string | null; helper_id?: string | null },
): Promise<"sent" | "already_told" | "no_helpr" | "error"> {
  if (!job.helper_id) return "no_helpr";
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", job.helper_id)
      .eq("job_id", job.id)
      .eq("title", ADD_PAYPAL_EMAIL_TITLE)
      .gte("created_at", since)
      .limit(1);
    if (error) return "error";
    if ((data ?? []).length > 0) return "already_told";
    const ok = await insertNotifications(admin, {
      user_id: job.helper_id,
      job_id: job.id,
      title: ADD_PAYPAL_EMAIL_TITLE,
      message: `"${job.title ?? "Your job"}" is approved. Add your PayPal email in Profile, Payments and we'll send your pay.`,
      type: "financial_alerts",
      link: "/profile?tab=payment",
    });
    return ok ? "sent" : "error";
  } catch {
    // Reported by the caller as a defect; this helper never throws into a payout run.
    return "error";
  }
}

/** The answers a release path counts as done: the claim and the payout row exist (held or not). */
export function isQueued(o: QueueOutcome): boolean {
  return o.outcome === "queued" || o.outcome === "queued_held" || o.outcome === "already_queued";
}
