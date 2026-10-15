import { posterPaidDollars, type PosterChargedJob } from "@/lib/posterJobCost";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";
import { stripeProcessingCostCents } from "../../supabase/functions/_shared/stripeFees";
import { cardCostFeeCents } from "@/lib/refundAmount";

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
 *    customer_fee_amount + urgent_fee + sales_tax_amount +
 *    onboarding_fee_amount, the line items create-payment bills), counted
 *    only when a card was actually charged:
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
 *    create-payment's cancel_escrow (less the non-refundable service fee) and
 *    void-cancelled-payments (less the cancellation fee and the service fee)
 *    both end 'refunded' (Q86: cancel_escrow ended 'cancelled' before
 *    2026-10-07, so older rows still carry that label). A 'cancelled' job
 *    whose PaymentIntent was never captured (void-cancelled-payments cancels
 *    the hold) has no refund row and no charged fee, and counts $0. On the old
 *    uncaptured-hold path void-cancelled-payments captured ONLY the fee (no
 *    refund row, cancellation_fee_status 'charged'): that job counts its
 *    cancellation_fee, capped at the charge (since Q1345 the cron stamps
 *    the cancellation fee it captured there; older rows carry the
 *    client-written figure), PLUS the crew block fees captured with it
 *    (Q1736: every crew_block_fees row but a void one, read through
 *    poster_crew_block_fee_cents, the sum the capture used).
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
 *    PaymentIntent. Manual tips get tips.stripe_payment_intent_id when their
 *    checkout completes (checkoutSessionCompleted, Q1344), so a refund or
 *    chargeback of one is matched like an auto tip's.
 *
 * Recurring visits are job rows of their own, so they count like any job.
 * The one-time account setup fee COUNTS (owner, 2026-10-12, Q1346), on the job
 * whose checkout kept it (jobs.onboarding_fee_amount, stamped by
 * stripe-webhook). Since Q1674 (owner, 2026-10-12) a cancel or refund keeps
 * it ("paid and done"), so charged - refunded includes it.
 * STILL OUT (not job spend, owner not asked): boosts, subscriptions and
 * gift-card purchases.
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
  /** Which path wrote the refund (payment_refunds.source). */
  source?: string | null;
}

/** One of the poster's jobs and the crew block fees owed on it (poster_crew_block_fee_cents, Q1736). */
export interface PosterBlockFeeRow {
  job_id: string;
  fee_cents: number;
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
export function posterSpentCents(job: PosterSpendJob, refundedCents: number, giftDollars: number, blockFeeCents = 0): number {
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
    // Uncaptured-hold cancellation: only the fees were captured, nothing
    // refunded: the cancellation fee and the crew's block fees (Q1736).
    if (job.cancellation_fee_status === "charged") {
      return Math.min(chargedCents, Math.max(0, cents(job.cancellation_fee ?? 0)) + Math.max(0, Math.round(blockFeeCents) || 0));
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
  /** Refunds ledgered against the job's own charge (0 for a tip row). */
  refundedCents: number;
  /** True when an admin refund (admin_refund_general) is among them. */
  adminRefunded: boolean;
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
  blockFees: readonly PosterBlockFeeRow[] = [],
): SpentRow<J>[] {
  const blockFeeByJob = new Map<string, number>();
  for (const b of blockFees) if (b.job_id) blockFeeByJob.set(b.job_id, (blockFeeByJob.get(b.job_id) ?? 0) + (Number(b.fee_cents) || 0));
  const refundedByPi = new Map<string, number>();
  for (const r of refunds) {
    if (r.stripe_payment_intent_id) refundedByPi.set(r.stripe_payment_intent_id, (refundedByPi.get(r.stripe_payment_intent_id) ?? 0) + (r.amount_cents ?? 0));
  }
  const jobPi = new Map(jobs.map((j) => [j.id, j.stripe_payment_intent_id]));
  const refundedByJob = new Map<string, number>();
  const adminRefundedJobs = new Set<string>();
  for (const r of refunds) {
    if (!r.job_id) continue;
    const pi = r.stripe_payment_intent_id ?? null;
    // A refund on another PaymentIntent than the job's own (a tip's) is not
    // this charge; the tip's refunds come off the tip below.
    if (pi && jobPi.get(r.job_id) && pi !== jobPi.get(r.job_id)) continue;
    refundedByJob.set(r.job_id, (refundedByJob.get(r.job_id) ?? 0) + (r.amount_cents ?? 0));
    if (r.source === "admin_refund_general") adminRefundedJobs.add(r.job_id);
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
    const c = posterSpentCents(job, refundedByJob.get(job.id) ?? 0, giftByJob.get(job.id) ?? 0, blockFeeByJob.get(job.id) ?? 0) + tipCents;
    if (c > 0) rows.push({ job, tip: null, cents: c, tipCents, refundedCents: refundedByJob.get(job.id) ?? 0, adminRefunded: adminRefundedJobs.has(job.id) });
  }
  for (const o of orphanTips) rows.push({ job: null, tip: o.tip, cents: o.cents, tipCents: o.cents, refundedCents: 0, adminRefunded: false });
  return rows;
}

/** The Spent total: the sum of spentRows(), in cents. */
export const spentTotalCents = (rows: readonly { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

/**
 * The receipt line for a job that carried the one-time setup fee (owner,
 * 2026-10-12, Q1674: kept on a cancel or refund, "paid and done"). Read from
 * the MONEY, not the status (lh-money-escrow review): no refund = the charge
 * includes it; a refund that left at least the fee on the charge = it was
 * kept; a refund that took it back too (before Q1674) = no line. Empty for
 * every job with no fee.
 */
export function setupFeeReceiptNote(
  job: PosterChargedJob & { onboarding_fee_amount?: number | null; dispute_status?: string | null; platform_fee_percent?: number | string | null },
  refundedCents: number,
  adminRefunded = false,
): string {
  const feeCents = cents(Number(job.onboarding_fee_amount ?? 0));
  if (!Number.isFinite(feeCents) || feeCents <= 0) return "";
  const amount = `$${(feeCents / 100).toFixed(2)}`;
  if (!(refundedCents > 0)) return ` · includes ${amount} one-time setup fee`;
  // What every refund path keeps BESIDES the setup fee: a cancel keeps the
  // service fee (floored at Stripe's cost), a dispute refund only Stripe's
  // cost. The fee was kept when what stayed on the card covers both; the two
  // real first jobs refunded before Q1674 kept only the service fee, so they
  // get no line (lh-money-escrow review).
  const chargedCents = cents(posterPaidDollars(job));
  const stripeCents = stripeProcessingCostCents(chargedCents);
  // An admin's full refund keeps the CARD fee as well as the setup fee (owner,
  // 2026-10-14: "if admin refunds we keep the fee also"; it used to keep only
  // the setup fee, owner 2026-10-12, Q1674 review N2). The card fee it keeps is
  // max(cardCostFeeCents(job), Stripe's real fee) (create-payment
  // admin_refund_general, _shared/refundAmount.ts); the client cannot read
  // Stripe's real fee, so it counts the part it can know: the card cost the
  // poster paid on a no-service-fee job (platform_fee_percent 0), and nothing
  // on a legacy 12% job (owner pop-up 2026-10-14: an admin refund never keeps
  // the old 12%). No admin refund on prod predates this with a setup fee
  // (measured 2026-10-14: 11 admin_refund_general rows, all is_seed, none on a
  // job with onboarding_fee_amount).
  const otherKeptCents = adminRefunded ? cardCostFeeCents(job) : job.dispute_status ? stripeCents : Math.max(cents(job.customer_fee_amount ?? 0), stripeCents);
  return chargedCents - refundedCents + 1 >= feeCents + otherKeptCents ? ` · ${amount} one-time setup fee kept (not refundable)` : "";
}
