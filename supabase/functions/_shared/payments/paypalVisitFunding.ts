/**
 * Funding the next visit of a repeat series paid through PayPal (PayPal Plan A, phase 6).
 *
 * TODAY'S RULES, UNCHANGED (charge-recurring-visits, measured 2026-10-23). The caller runs the
 * whole Stripe-era eligibility walk first and unchanged (the FUND_LEAD_DAYS = 3 window, series
 * ended, chargebacks, the date's holder, bans, blocks, under-18 and not-ready holders, the
 * per-run cap, a pending on-session payment) and only then hands one visit date here. Then:
 *   - A VISIT IS CREATED ONLY ONCE ITS MONEY IS IN. The charge comes first, the visit job row
 *     after it; a failed charge produces no visit.
 *   - The price: the visit's budget; a poster-fee series adds posterJobFeeCents (its parent's
 *     stamp, refused on PayPal: the PayPal path never uses that model); a flat-model series adds nothing (roadmap F3). The Helpr's provisional fee on the
 *     row is jobHelprCommissionDollars with the parent's stamp, as today.
 *   - The visit row is the same insert as today (every descriptive field copied from the
 *     parent, the date's holder as helper, accepted and confirmed, payment_status 'escrow',
 *     the parent's fee stamps), with no Stripe id: the PayPal payment names the row it funds
 *     (provider_payments.funds_job_id), which is how the cancel sweep finds it.
 *   - A visit that already exists for the date is never charged again; a race that charged
 *     twice refunds the duplicate in full (our own mistake: owner 2026-10-14, card fee included).
 *
 * NOT ON PAYPAL YET (refused with a reason the caller pages on; nothing is charged):
 *   a legacy-fee series (no flat stamp), a taxable-labor series (the visit tax needs phase 3's
 *   parish tax, not Stripe Tax), and a visit of $300 or more (today it is parked for the poster
 *   to pay on-session; the PayPal on-session visit checkout is not built).
 */
import { jobHelprCommissionDollars } from "../helperFees.ts";
import { flatFeePercentOf, isFlatFeeJob } from "../helprFlatFee.ts";
import { POSTER_SERVICE_FEE_PERCENT } from "../posterFees.ts";
import { isPosterFeeJob } from "../posterJobFee.ts";
import { isLaborTaxable } from "../salesTax.ts";
import { THREE_D_SECURE_MIN_CENTS } from "../threeDSecure.ts";
import { chargeSavedPayment, visitSubjectId, type SavedChargeDeps } from "./paypalSavedCharge.ts";
import type { PaymentProvider } from "./types.ts";

/** The parent (series) columns charge-recurring-visits already selects. */
export interface SeriesParent {
  id: string;
  customer_id: string;
  category: string | null;
  budget: number | string;
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
  poster_fee_flat_cents?: number | string | null;
  platform_fee_percent?: number | string | null;
  [column: string]: unknown;
}

export type VisitPlan =
  | { kind: "plan"; budgetCents: number; feeCents: number; taxCents: 0; totalCents: number; helperFeePercent: number; helperFeeAmount: number }
  | { kind: "refuse"; reason: string };

export function planPayPalVisitCharge(parent: SeriesParent): VisitPlan {
  const budgetCents = Math.round(Number(parent.budget) * 100);
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) return { kind: "refuse", reason: "visit_budget_invalid" };
  if (!isFlatFeeJob(parent)) return { kind: "refuse", reason: "series_fee_model_not_on_paypal" };
  if (isLaborTaxable(parent.category)) return { kind: "refuse", reason: "taxable_visit_not_on_paypal" };
  // The PayPal path never uses the poster-fee model (shared contract, helprFlatFee.ts
  // PAYPAL_HELPR_FEE_*): a poster-fee series was not funded through PayPal.
  if (isPosterFeeJob(parent)) return { kind: "refuse", reason: "poster_fee_series_not_on_paypal" };
  const feeCents = 0;
  const totalCents = budgetCents + feeCents;
  if (totalCents >= THREE_D_SECURE_MIN_CENTS) return { kind: "refuse", reason: "visit_needs_on_session_payment_not_on_paypal" };
  const helperFeePercent = flatFeePercentOf(parent) as number;
  return {
    kind: "plan",
    budgetCents,
    feeCents,
    taxCents: 0,
    totalCents,
    helperFeePercent,
    helperFeeAmount: jobHelprCommissionDollars(parent, budgetCents / 100, helperFeePercent, 0),
  };
}

export interface VisitStore {
  /** The visit job for (series, date), if one exists, and how it is funded. */
  visitJobFor(parentId: string, visitDate: string): Promise<{ id: string; stripePaymentIntentId: string | null; fundedByPaymentId: string | null } | null>;
  /** Insert the visit job row. A UNIQUE clash comes back as code '23505'. */
  insertVisitJob(row: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; code: string | null; message: string }>;
  /** Stamp the payment with the job it funds (once; the database refuses a change). Throws on failure. */
  linkPaymentToJob(paymentId: string, jobId: string): Promise<void>;
  /** The job a payment already funds, if any. */
  jobFundedBy(paymentId: string): Promise<string | null>;
  /** Record a refund row (pending) for a payment and return its id (UNIQUE key: re-read on clash). */
  insertRefund(paymentId: string, idempotencyKey: string, amountCents: number, reason: string): Promise<{ id: string; status: string; providerRefundId: string | null }>;
  /** Throws when it matched no row. */
  markRefund(id: string, status: "completed" | "pending" | "failed", providerRefundId: string | null): Promise<void>;
  /** After a refund of the whole capture: the payment reads 'refunded' (never funded again). */
  setPaymentStatus(paymentId: string, status: "refunded" | "partially_refunded"): Promise<void>;
  captureIdOf(paymentId: string): Promise<string>;
}

export interface VisitDeps {
  charge: SavedChargeDeps;
  store: VisitStore;
  provider: Pick<PaymentProvider, "refund">;
  /** PayPal's fee on a capture (kept when an unbooked visit is refunded: owner, never absorb a fee). */
  readCaptureFeeCents(providerCaptureId: string): Promise<number | null>;
}

export type VisitOutcome =
  /** `booked`: this run created or linked the visit, so the caller books the parties (application, notices). */
  | { outcome: "funded"; childJobId: string; paymentId: string; totalCents: number; booked: boolean }
  | { outcome: "exists" }
  | { outcome: "refused"; reason: string }
  | { outcome: "no_saved_method" }
  /** `fresh`: this run's decline (tell the poster); a standing one was told already. */
  | { outcome: "declined"; reason: string; fresh: boolean }
  /** Captured, not settled: no visit yet (money not in). The next run in the window adopts it. */
  | { outcome: "awaiting_settlement"; paymentId: string }
  /**
   * The visit could not be booked after its money came in (the series ended or the date changed
   * hands mid-run): the money went back, less PayPal's fee (today's rule). Tell the poster.
   */
  | { outcome: "refunded_unbooked"; paymentId: string; providerRefundId: string | null; refundCents: number; keptCents: number; reason: string }
  /** A duplicate charge for a date another payment already funds, refunded in full. Tell the poster. */
  | { outcome: "refunded_duplicate"; paymentId: string; providerRefundId: string | null; refundCents: number; winnerJobId: string }
  | { outcome: "retry"; reason: string }
  | { outcome: "needs_review"; reason: string };

/** The visit row: today's insert (charge-recurring-visits "Charge, then create"), minus the Stripe id. */
export function visitJobRow(parent: SeriesParent, visitDate: string, holderId: string, plan: Extract<VisitPlan, { kind: "plan" }>, nowIso: string): Record<string, unknown> {
  const posterFeeSeries = isPosterFeeJob(parent);
  return {
    customer_id: parent.customer_id,
    business_id: parent.business_id ?? null,
    title: parent.title,
    description: parent.description,
    category: parent.category,
    budget: plan.budgetCents / 100,
    date_needed: visitDate,
    start_time: parent.start_time ?? null,
    location: parent.location,
    parish: parent.parish,
    zip_code: parent.zip_code,
    latitude: parent.latitude,
    longitude: parent.longitude,
    estimated_hours: parent.estimated_hours,
    special_requirements: parent.special_requirements,
    photos: parent.photos,
    is_flexible_schedule: parent.is_flexible_schedule,
    parent_job_id: parent.id,
    helper_id: holderId,
    status: "accepted",
    helper_confirmed_at: nowIso,
    payment_status: "escrow",
    platform_fee_percent: posterFeeSeries ? Number(parent.platform_fee_percent) : POSTER_SERVICE_FEE_PERCENT,
    platform_fee_amount: plan.helperFeeAmount,
    customer_fee_amount: plan.feeCents / 100,
    helper_fee_percent: plan.helperFeePercent,
    helper_fee_flat_cents: Number(parent.helper_fee_flat_cents),
    ...(posterFeeSeries ? { poster_fee_flat_cents: Number(parent.poster_fee_flat_cents) } : {}),
    sales_tax_rate: 0,
    sales_tax_amount: 0,
    is_recurring: false,
    is_urgent: false,
    urgent_fee: 0,
  };
}


const UNBOOKABLE = /^(series_ended|series_date_unheld):/;

export async function fundPayPalVisit(
  deps: VisitDeps,
  i: { parent: SeriesParent; visitDate: string; holderId: string; nowIso?: string },
): Promise<VisitOutcome> {
  if (await deps.store.visitJobFor(i.parent.id, i.visitDate)) return { outcome: "exists" };
  const plan = planPayPalVisitCharge(i.parent);
  if (plan.kind === "refuse") return { outcome: "refused", reason: plan.reason };

  const subjectId = await visitSubjectId(i.parent.id, i.visitDate);
  const res = await chargeSavedPayment(deps.charge, {
    subjectKind: "recurring_visit",
    subjectId,
    payerId: i.parent.customer_id,
    amountCents: plan.totalCents,
  });
  switch (res.outcome) {
    case "switch_off": return { outcome: "refused", reason: "paypal_switch_off_for_poster" };
    case "no_saved_method": return { outcome: "no_saved_method" };
    case "declined": return { outcome: "declined", reason: res.reason, fresh: res.fresh };
    case "pending": return { outcome: "awaiting_settlement", paymentId: res.paymentId };
    case "unreadable": return { outcome: "retry", reason: res.reason };
    case "retry": return { outcome: "retry", reason: res.reason };
    case "needs_review": return { outcome: "needs_review", reason: res.reason };
    case "charged": break;
  }
  const paymentId = res.paymentId;
  // Adopt: an earlier run charged this visit and may already have made and linked its row.
  const already = await deps.store.jobFundedBy(paymentId);
  if (already) return { outcome: "funded", childJobId: already, paymentId, totalCents: plan.totalCents, booked: false };

  const link = async (jobId: string): Promise<VisitOutcome> => {
    try {
      await deps.store.linkPaymentToJob(paymentId, jobId);
    } catch (e) {
      // The visit exists but its money is not named on it: the cancel sweep heals this by subject,
      // but a person must know now (never a quiet "retry" no run would ever retry).
      return { outcome: "needs_review", reason: `visit ${jobId} booked but payment ${paymentId} not linked: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
    }
    return { outcome: "funded", childJobId: jobId, paymentId, totalCents: plan.totalCents, booked: true };
  };

  const ins = await deps.store.insertVisitJob(visitJobRow(i.parent, i.visitDate, i.holderId, plan, i.nowIso ?? new Date().toISOString()));
  if (ins.ok) return await link(ins.id);

  const refundWhole = async (amountCents: number, key: string, reason: string, note: string): Promise<{ ok: true; providerRefundId: string | null } | { ok: false; why: string }> => {
    const r = await deps.store.insertRefund(paymentId, key, amountCents, reason);
    if (r.status === "completed" || r.providerRefundId) return { ok: true, providerRefundId: r.providerRefundId };
    try {
      const out = await deps.provider.refund({ idempotencyKey: `lh:refund:${r.id}`, providerCaptureId: await deps.store.captureIdOf(paymentId), amountCents, note, invoiceId: r.id });
      await deps.store.markRefund(r.id, out.settled ? "completed" : "pending", out.providerRefundId);
      if (out.amountCents !== amountCents) return { ok: false, why: `refund_amount_mismatch: asked ${amountCents}, PayPal refunded ${out.amountCents}` };
      await deps.store.setPaymentStatus(paymentId, amountCents >= plan.totalCents ? "refunded" : "partially_refunded");
      return { ok: true, providerRefundId: out.providerRefundId };
    } catch (e) {
      return { ok: false, why: e instanceof Error ? e.message : String(e) };
    }
  };

  if (ins.code === "23505") {
    // Another row holds the date. Whose money is behind it?
    const winner = await deps.store.visitJobFor(i.parent.id, i.visitDate);
    if (!winner) return { outcome: "needs_review", reason: `23505 but no visit row readable; payment ${paymentId} captured, not refunded` };
    // Funded by THIS payment (a concurrent run of the same charge), or by nothing: it is ours.
    if (winner.fundedByPaymentId === paymentId) return { outcome: "funded", childJobId: winner.id, paymentId, totalCents: plan.totalCents, booked: false };
    if (!winner.stripePaymentIntentId && !winner.fundedByPaymentId) return await link(winner.id);
    // Funded by other money: this charge is a duplicate. Refund it IN FULL, PayPal's fee included
    // (own-mistake full refund (owner, 2026-10-14)).
    const done = await refundWhole(plan.totalCents, `lh:pp:${paymentId}:duplicate-visit-refund`, "duplicate_visit_charge", "A duplicate charge for one visit, returned");
    if (!done.ok) return { outcome: "needs_review", reason: `duplicate visit charge ${paymentId} NOT refunded: ${done.why}`.slice(0, 300) };
    return { outcome: "refunded_duplicate", paymentId, providerRefundId: done.providerRefundId, refundCents: plan.totalCents, winnerJobId: winner.id };
  }
  if (UNBOOKABLE.test(ins.message)) {
    // Today's rule for a visit that cannot be booked after its charge (charge-recurring-visits
    // withholdMidRun): the money goes back less the processor's fee.
    const fee = await deps.readCaptureFeeCents(await deps.store.captureIdOf(paymentId));
    if (fee === null) return { outcome: "retry", reason: `visit not bookable (${ins.message.slice(0, 80)}); PayPal's fee unreadable, refund next run` };
    const back = Math.max(0, plan.totalCents - fee);
    let providerRefundId: string | null = null;
    if (back > 0) {
      const done = await refundWhole(back, `lh:pp:${paymentId}:unbooked-visit-refund`, "visit_not_bookable", "Your visit could not be booked; your payment is returned");
      if (!done.ok) return { outcome: "needs_review", reason: `unbookable visit ${paymentId} NOT refunded: ${done.why}`.slice(0, 300) };
      providerRefundId = done.providerRefundId;
    }
    return { outcome: "refunded_unbooked", paymentId, providerRefundId, refundCents: back, keptCents: plan.totalCents - back, reason: ins.message.slice(0, 120) };
  }
  // Any other refusal: the money is in and recorded against this visit's subject; the next run in
  // the window adopts it (chargeSavedPayment finds the funded row) and inserts again.
  return { outcome: "needs_review", reason: `visit insert failed after charge ${paymentId}: ${ins.message}`.slice(0, 300) };
}
