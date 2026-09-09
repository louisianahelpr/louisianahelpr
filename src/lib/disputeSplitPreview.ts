// disputeSplitPreview — what each party ACTUALLY receives from a dispute split,
// so the admin decides on the numbers the parties will see rather than on two
// percentages of a gross budget.
//
// The admin console showed only gross: "Poster 50% ($90.00) · Helpr 50%
// ($90.00)". Neither side ever receives that. The Helpr's leg is transferred
// minus the platform commission; the poster's leg is refunded minus the slice
// of Stripe's processing fee Stripe keeps on a refund. On a $180 job at 12%
// that is $90 → $79.20 and $90 → ~$86.60 — a $14 gap between what the admin
// approved and what lands, on the one screen where an admin is deciding a
// contested payment.
//
// The formulas here MIRROR `supabase/functions/execute-dispute-split/index.ts`
// (§ "Poster leg" / "helper leg") and reuse the same shared modules the
// executor's own imports resolve to, so the ladder in `subscriptionTiers.ts`
// stays the single source of the commission and `stripeFees.ts` the single
// source of the processing cost. A hardcoded percentage here would be exactly
// the drift this module exists to prevent.
//
// ONE HONEST APPROXIMATION, and it is labelled as such in the UI. The executor
// refunds a share of what Stripe actually CAPTURED, read off the PaymentIntent.
// The client cannot read a PaymentIntent, so `capturedDollars` is reconstructed
// from the job's own line items (budget + service fee + urgent fee + sales tax
// — the four `create-payment` puts on the Checkout Session). It agrees with the
// capture on every ordinary job and can differ on one the poster part-paid with
// a Pay-It-Forward gift, where part of the escrow is credit rather than cash.
// The Helpr's figure carries no such caveat: it is exact.

import { tierFeePercent } from "@/lib/subscriptionTiers";
import { netUrgentFeeDollars, stripeProcessingCostCents } from "@/lib/stripeFees";
import { helperDisplayFeePercent, helperShareCount, type HelperEarningsJob } from "@/lib/helperEarnings";

export interface DisputeSplitJob extends HelperEarningsJob {
  customer_fee_amount?: number | null;
  sales_tax_amount?: number | null;
}

export interface SplitPreview {
  /**
   * Each party's share of ITS OWN basis, before that leg's deduction — so
   * `gross − deduction === net` holds in both columns. The two bases differ on
   * purpose, exactly as the executor's do: the Helpr's leg is drawn from the
   * budget (plus the net urgent fee), the poster's from the whole CAPTURE
   * (budget + service fee + urgent fee + sales tax), because the poster paid
   * the service fee and tax and gets their share of those back.
   *
   * These used to be the same basis for both — `budget × share` — while the
   * nets were not, which on a $60 job with a $6 service fee split 50/50 printed
   * "$31.90 refunded / $30.00 gross / −$1.11 Stripe keeps": a net ABOVE its own
   * gross, with a deduction that reconciled nothing.
   */
  helperGross: number;
  posterGross: number;
  /** What the Helpr's Connect account is credited — exact. */
  helperNet: number;
  /** The platform commission withheld from the Helpr's leg. */
  helperCommission: number;
  /** What the poster's card is refunded — estimated from the job's line items. */
  posterNet: number;
  /**
   * Processing cost Stripe keeps on the poster's leg — the REMAINDER,
   * `posterGross − posterNet`, so the three numbers in the column add up.
   * Equal to the poster's pro-rata share of `stripeProcessingCostCents` up to
   * the executor's own cent-rounding of the refund.
   */
  posterProcessingCost: number;
  /** The commission rate applied, for display. */
  helperFeePercent: number;
}

/**
 * @param job          the disputed job row
 * @param helperShare  0..1 — the Helpr's share of the award
 * @param helperTier   the Helpr's live subscription tier, used only when the
 *                     job carries no frozen rate (same fallback order as
 *                     `getHelperFeePercent` in the executor)
 */
export function previewDisputeSplit(
  job: DisputeSplitJob,
  helperShare: number,
  helperTier: string | null | undefined,
): SplitPreview {
  const share = Math.min(1, Math.max(0, helperShare));
  const posterShare = 1 - share;
  const shares = helperShareCount(job);
  const budget = job.budget ?? 0;

  // ── Helpr leg — exact, and identical to the executor's arithmetic ──────
  const feePercent = helperDisplayFeePercent(job, tierFeePercent(helperTier));
  const budgetShare = (budget / shares) * share;
  const urgentShare = (netUrgentFeeDollars(job.urgent_fee) / shares) * share;
  // Byte-for-byte `helperCommissionDollars` from the edge module the executor
  // imports — round to cents ONCE, on the commission, so the client's figure and
  // the transfer agree exactly. Inlined rather than imported because app code
  // must not reach into `supabase/functions/`; `disputeSplitPreview.parity.test.ts`
  // asserts the two stay identical.
  const commission = Math.round(budgetShare * feePercent) / 100;
  const helperNet = Math.max(0, budgetShare + urgentShare - commission);

  // ── Poster leg — a share of the CAPTURE, less what Stripe keeps ────────
  // Stripe's cost is charged on the whole capture and is not returned on a
  // refund, so the poster's share of it is pro rata to their share of the
  // award — exactly what the executor computes as
  // `(captured − nonRefundable) × posterShare`.
  const captured =
    budget +
    (job.customer_fee_amount ?? 0) +
    (job.urgent_fee ?? 0) +
    (job.sales_tax_amount ?? 0);
  const capturedCents = Math.round(captured * 100);
  const processingCents = capturedCents > 0 ? stripeProcessingCostCents(capturedCents) : 0;
  const refundableCents = Math.max(0, capturedCents - processingCents);
  // `Math.round` to whole cents, mirroring the executor's
  // `refundCents = Math.max(0, Math.round(refundableCents * posterShare))`.
  const posterNet = Math.round(refundableCents * posterShare) / 100;
  const posterGross = Math.round(capturedCents * posterShare) / 100;

  return {
    helperGross: budgetShare + urgentShare,
    posterGross,
    helperNet,
    helperCommission: commission,
    posterNet,
    // The remainder, not an independent computation — see the field's doc.
    posterProcessingCost: posterGross - posterNet,
    helperFeePercent: feePercent,
  };
}
