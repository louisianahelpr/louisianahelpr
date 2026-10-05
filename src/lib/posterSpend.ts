import { posterPaidDollars, type PosterChargedJob } from "@/lib/posterJobCost";

/**
 * WHAT A POSTER REALLY SPENT on a job: what their card was charged, less what
 * came back to it (owner, 2026-10-04: "Fix Spent first, then ship" — the Spent
 * total counted a $50 job that was closed with no payment).
 *
 * The Money tab's Spent total and its "Jobs you paid for" list are BOTH built
 * from spentRows() below, so the total is always the sum of the rows.
 *
 * Read from the columns and ledgers the money path writes, never re-derived:
 *  - The charge: posterPaidDollars() (posterJobCost.ts — budget +
 *    customer_fee_amount + urgent_fee + sales_tax_amount, the line items
 *    create-payment bills), counted only when a card was actually charged:
 *    a Stripe PaymentIntent on the job AND a payment_status that means the
 *    money was collected. A job closed with no payment (payment_status
 *    'cancelled'/'unpaid'/'abandoned'/'failed', no PI) cost the poster
 *    nothing.
 *  - A gift card: redeem_gift_card applies min(budget + urgent_fee, gift) to
 *    the job and the card pays only the rest, so that much is not card spend.
 *    A job the gift covered in full has no PI and counts $0.
 *  - Refunds: the payment_refunds ledger (one row per Stripe refund; written
 *    by charge.refunded, create-payment, execute-dispute-split,
 *    process-scheduled-payouts, and checked against Stripe by
 *    money-reconciliation). Kept = charged − refunded. A full refund drops
 *    the job out; a partial one shows what was kept. A job whose status says
 *    'refunded' but whose ledger rows are missing counts $0: the status is
 *    the stronger claim that the money went back.
 *  - A card chargeback: payment_status 'chargeback' counts $0 — the poster's
 *    bank has pulled the money back. If the platform wins the dispute,
 *    charge.dispute.closed restores the status and the job counts again.
 *
 * DELIBERATELY OUT (same rule as posterJobCost.ts): tips, a separate charge
 * in the `tips` table that is not part of what the job cost; and the one-time
 * account setup fee, charged per account, never to a job.
 */

/** payment_status values under which the job's charge was collected. */
export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling"] as const;

export interface PosterSpendJob extends PosterChargedJob {
  id: string;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
}

export interface PosterRefundRow {
  job_id: string;
  amount_cents: number;
}

export interface PosterGiftRow {
  job_id: string | null;
  amount: number;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** Card cents the poster kept paying for one job (0 when nothing was spent). */
export function posterSpentCents(job: PosterSpendJob, refundedCents: number, giftDollars: number): number {
  if (!job.stripe_payment_intent_id) return 0;
  if (!(CHARGED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "")) return 0;
  const workCents = cents((job.budget ?? 0) + (job.urgent_fee ?? 0));
  const giftCents = Math.min(workCents, Math.max(0, cents(giftDollars)));
  const chargedCents = Math.max(0, cents(posterPaidDollars(job)) - giftCents);
  if (job.payment_status === "refunded" && refundedCents <= 0) return 0;
  return Math.max(0, chargedCents - Math.max(0, refundedCents));
}

/**
 * The jobs the poster really paid for, each with the cents they kept paying,
 * in the input order. Jobs that cost nothing are left out, so the Spent list
 * and the Spent total (the sum of these rows) can never disagree.
 */
export function spentRows<J extends PosterSpendJob>(
  jobs: readonly J[],
  refunds: readonly PosterRefundRow[],
  gifts: readonly PosterGiftRow[],
): { job: J; cents: number }[] {
  const refundedByJob = new Map<string, number>();
  for (const r of refunds) refundedByJob.set(r.job_id, (refundedByJob.get(r.job_id) ?? 0) + (r.amount_cents ?? 0));
  const giftByJob = new Map<string, number>();
  for (const g of gifts) if (g.job_id) giftByJob.set(g.job_id, (giftByJob.get(g.job_id) ?? 0) + (g.amount ?? 0));
  const rows: { job: J; cents: number }[] = [];
  for (const job of jobs) {
    const c = posterSpentCents(job, refundedByJob.get(job.id) ?? 0, giftByJob.get(job.id) ?? 0);
    if (c > 0) rows.push({ job, cents: c });
  }
  return rows;
}

/** The Spent total: the sum of spentRows(), in cents. */
export const spentTotalCents = (rows: readonly { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
