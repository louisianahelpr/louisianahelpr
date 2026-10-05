import { posterPaidDollars, type PosterChargedJob } from "@/lib/posterJobCost";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";

/**
 * WHAT A POSTER REALLY SPENT on the jobs they posted: what left their card,
 * less what came back to it (owner, 2026-10-04: "Fix Spent first" — the Spent
 * total counted a $50 job that was closed with no payment; 2026-10-05, on the
 * screenshots: tips and cancellation fees COUNT, "everything that actually
 * left the poster's card").
 *
 * The Money tab's Spent total and its "Jobs you paid for" list are BOTH built
 * from spentRows() below, so the total is always the sum of the rows. One row
 * per job the poster has ever posted that kept any of their money (whatever its
 * status: money held in escrow on an open or in-progress job has left the card
 * too), with that job's tips in it; a paid tip whose job is not in the list gets
 * a row of its own.
 *
 * Read from the columns and ledgers the money path writes, never re-derived:
 *  - The job charge: posterPaidDollars() (posterJobCost.ts — budget +
 *    customer_fee_amount + urgent_fee + sales_tax_amount, the line items
 *    create-payment bills), counted only when a card was actually charged:
 *    a Stripe PaymentIntent on the job AND a payment_status that means the
 *    money was collected. A job closed with no payment (payment_status
 *    'cancelled'/'unpaid'/'abandoned'/'failed', no PI) cost nothing.
 *  - A gift card: redeem_gift_card applies min(budget + urgent_fee, gift) to
 *    the job and the card pays only the rest, so that much is not card spend.
 *    A job the gift covered in full has no PI and counts $0.
 *  - Refunds: the payment_refunds ledger (one row per Stripe refund; written
 *    by charge.refunded, create-payment, execute-dispute-split,
 *    void-cancelled-payments, process-scheduled-payouts, and checked against
 *    Stripe by money-reconciliation). A job's refunds are its rows whose
 *    PaymentIntent is the job's (or unrecorded); a tip's are the rows on the
 *    tip's PaymentIntent. Kept = charged − refunded. A full refund drops the
 *    job out; a partial one shows what was kept.
 *  - A CANCELLED job: the same rule, charged − refunded. Both cancel doors
 *    refund the capture less what is kept and write a payment_refunds row:
 *    create-payment's cancel_escrow (less the non-refundable service fee) ends
 *    payment_status 'cancelled'; void-cancelled-payments (less the
 *    cancellation fee and the service fee) ends 'refunded'. A 'cancelled' job
 *    whose PaymentIntent was never captured (void-cancelled-payments cancels
 *    the hold) has no refund row and no charged fee, and counts $0. On the old
 *    uncaptured-hold path void-cancelled-payments captured ONLY the fee (no
 *    refund row, cancellation_fee_status 'charged'): that job counts its
 *    cancellation_fee, capped at the charge (Q1329: that column is
 *    client-written; the server should stamp the amount it captured).
 *  - A 'refunded' status with no ledger rows and no charged cancellation fee
 *    counts $0: the status is the stronger claim that the money went back.
 *  - A card chargeback: payment_status 'chargeback' counts $0 — the poster's
 *    bank has pulled the money back. If the platform wins the dispute,
 *    charge.dispute.closed restores the status and the job counts again.
 *  - Tips: a separate charge in `tips` (pending/paid/failed). Only 'paid'
 *    counts, at what the card was charged: the tip PLUS its card-processing
 *    fee (create-payment's tip action and auto-tip-charge bill
 *    tipChargeBreakdown(tip).chargeCents; tips.amount stores only the tip, so
 *    a $3 tip charged $3.40), less any refund ledgered on the tip's
 *    PaymentIntent. Manual tips
 *    never stamp tips.stripe_payment_intent_id (checkoutSessionCompleted), so
 *    a refund or chargeback of a manual tip cannot be matched yet (Q1328).
 *
 * Recurring visits are job rows of their own, so they count like any job.
 * STILL OUT (not job spend, owner not asked): the one-time account setup fee
 * (charged once per account, never stamped on a job), boosts, subscriptions
 * and gift-card purchases.
 */

/** payment_status values under which the job's charge was collected. */
export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling"] as const;

export interface PosterSpendJob extends PosterChargedJob {
  id: string;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  /** Fee kept on a cancellation (client estimate; the server recomputes it when it moves money). */
  cancellation_fee?: number | null;
  /** 'charged' once void-cancelled-payments kept a cancellation fee. */
  cancellation_fee_status?: string | null;
}

export interface PosterRefundRow {
  job_id: string | null;
  amount_cents: number;
  stripe_payment_intent_id?: string | null;
}

export interface PosterGiftRow {
  job_id: string | null;
  amount: number;
}

export interface PosterTipRow {
  id: string;
  job_id: string | null;
  amount: number;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  created_at?: string | null;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** Card cents the poster kept paying for one job's own charge (0 when nothing was spent). */
export function posterSpentCents(job: PosterSpendJob, refundedCents: number, giftDollars: number): number {
  if (!job.stripe_payment_intent_id) return 0;
  // 'cancelled' with a PaymentIntent is either cancel_escrow's refunded capture
  // (a refund row; what was withheld is spent) or a hold that was never
  // captured (no refund row, no fee charged: nothing spent).
  const cancelledAfterCapture =
    job.payment_status === "cancelled" && (refundedCents > 0 || job.cancellation_fee_status === "charged");
  if (!cancelledAfterCapture && !(CHARGED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "")) return 0;
  const workCents = cents((job.budget ?? 0) + (job.urgent_fee ?? 0));
  const giftCents = Math.min(workCents, Math.max(0, cents(giftDollars)));
  const chargedCents = Math.max(0, cents(posterPaidDollars(job)) - giftCents);
  if (job.payment_status === "refunded" && refundedCents <= 0) {
    // Uncaptured-hold cancellation: only the fee was captured, nothing refunded.
    if (job.cancellation_fee_status === "charged") {
      return Math.min(chargedCents, Math.max(0, cents(job.cancellation_fee ?? 0)));
    }
    return 0;
  }
  return Math.max(0, chargedCents - Math.max(0, refundedCents));
}

/** Card cents the poster kept paying for one tip (0 unless it was paid). */
export function tipSpentCents(tip: PosterTipRow, refundedCents: number): number {
  if (tip.payment_status !== "paid") return 0;
  const charged = tipChargeBreakdown(cents(tip.amount ?? 0)).chargeCents;
  return Math.max(0, charged - Math.max(0, refundedCents));
}

export interface SpentRow<J> {
  /** The job, or null for a paid tip whose job is not in the list. */
  job: J | null;
  /** That tip, when `job` is null. */
  tip: PosterTipRow | null;
  /** Everything kept for this row: the job's charge plus its tips. */
  cents: number;
  /** The tips part of `cents`. */
  tipCents: number;
}

/**
 * The jobs the poster really paid for, each with the cents they kept paying
 * (charge + tips), in the input order, then any orphan tips. Rows that cost
 * nothing are left out, so the Spent list and the Spent total (the sum of these
 * rows) can never disagree.
 */
export function spentRows<J extends PosterSpendJob>(
  jobs: readonly J[],
  refunds: readonly PosterRefundRow[],
  gifts: readonly PosterGiftRow[],
  tips: readonly PosterTipRow[] = [],
): SpentRow<J>[] {
  const refundedByPi = new Map<string, number>();
  for (const r of refunds) {
    if (r.stripe_payment_intent_id) refundedByPi.set(r.stripe_payment_intent_id, (refundedByPi.get(r.stripe_payment_intent_id) ?? 0) + (r.amount_cents ?? 0));
  }
  const jobPi = new Map(jobs.map((j) => [j.id, j.stripe_payment_intent_id]));
  const refundedByJob = new Map<string, number>();
  for (const r of refunds) {
    if (!r.job_id) continue;
    const pi = r.stripe_payment_intent_id ?? null;
    // A refund on another PaymentIntent than the job's own (a tip's) is not
    // this charge; the tip's refunds come off the tip below.
    if (pi && jobPi.get(r.job_id) && pi !== jobPi.get(r.job_id)) continue;
    refundedByJob.set(r.job_id, (refundedByJob.get(r.job_id) ?? 0) + (r.amount_cents ?? 0));
  }
  const giftByJob = new Map<string, number>();
  for (const g of gifts) if (g.job_id) giftByJob.set(g.job_id, (giftByJob.get(g.job_id) ?? 0) + (g.amount ?? 0));
  const tipCentsByJob = new Map<string, number>();
  const orphanTips: { tip: PosterTipRow; cents: number }[] = [];
  const jobIds = new Set(jobs.map((j) => j.id));
  for (const t of tips) {
    const c = tipSpentCents(t, t.stripe_payment_intent_id ? refundedByPi.get(t.stripe_payment_intent_id) ?? 0 : 0);
    if (c <= 0) continue;
    if (t.job_id && jobIds.has(t.job_id)) tipCentsByJob.set(t.job_id, (tipCentsByJob.get(t.job_id) ?? 0) + c);
    else orphanTips.push({ tip: t, cents: c });
  }
  const rows: SpentRow<J>[] = [];
  for (const job of jobs) {
    const tipCents = tipCentsByJob.get(job.id) ?? 0;
    const c = posterSpentCents(job, refundedByJob.get(job.id) ?? 0, giftByJob.get(job.id) ?? 0) + tipCents;
    if (c > 0) rows.push({ job, tip: null, cents: c, tipCents });
  }
  for (const o of orphanTips) rows.push({ job: null, tip: o.tip, cents: o.cents, tipCents: o.cents });
  return rows;
}

/** The Spent total: the sum of spentRows(), in cents. */
export const spentTotalCents = (rows: readonly { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
