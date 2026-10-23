// posterCancelSplit — THE one split of a poster's cancelled-job payment into
// what goes back to them and what is kept (boards 66/172 slice 2, 2026-10-21).
//
// Two callers, one function, so the number the poster is SHOWN before they
// cancel and the money that MOVES afterwards cannot disagree:
//   * create-payment `cancel_quote`: the poster's cancel dialog asks it
//     ("Back to you $X") before anything is confirmed;
//   * void-cancelled-payments: the hourly sweep that captures the fee and
//     refunds the rest once the job is cancelled.
//
// The inputs are the ones only the server can know: what the card holds or
// captured, Stripe's real fee on that charge, the sales tax in it, what earlier
// refunds already returned, a first job's kept setup fee, and the fee model the
// job was stamped with. The cancellation fee itself is priced by the caller
// from the shared ladder (_shared/cancellationFee.ts computeCancellationFee),
// which is what poster_cancel_job records and checks p_expected_fee_cents
// against.
//
// A gift card that paid toward the job is NOT priced here: the sweep settles a
// gift's part separately (giftCoversShortfall / restore_gift_card_for_job), so
// the quote declines to show a number for a gift-paid job rather than show one
// the sweep did not compute.
//
// One deliberate difference (lh-money-escrow review nit 2, accepted): the quote
// reads the charge's tax with checkoutChargeTaxCents and shows NO number when
// that read fails; the sweep reads it with chargeTaxCentsFor, where a failed
// read keeps no tax. So a sweep whose tax read fails can only return MORE than
// the quote said, never less. Do not "fix" the quote to read a failure as 0.
//
// Zero Deno imports at module scope, so vitest imports it directly.

import { posterCancelKeptFeeCents, refundToPayerCents, type RefundToPayerResult } from "./refundAmount.ts";
import { setupFeeKeptCents } from "./posterFees.ts";
import { refundsSeriesVisitInFull, type SeriesRefundJob } from "./seriesRefund.ts";

/** The job columns the split reads (all from `jobs`, plus series_ban_cancelled_at). */
interface PosterCancelSplitJob extends SeriesRefundJob {
  customer_fee_amount?: number | string | null;
  onboarding_fee_amount?: number | string | null;
}

/** The card payment behind the job, as Stripe reports it. */
type PosterCancelCharge =
  /** An uncaptured authorization (pi.status 'requires_capture'). */
  | { state: "hold"; amountCents: number; capturableCents: number }
  /** A captured charge (pi.status 'succeeded'). */
  | {
      state: "captured";
      /** pi.amount_received (else pi.amount). */
      capturedCents: number;
      /** actualOrEstimatedFeeCents(pi, capturedCents). */
      actualFeeCents: number;
      /** latest_charge.amount_refunded: what earlier refunds already returned. */
      alreadyRefundedCents: number;
      /** chargeTaxCentsFor(stripe, pi). */
      taxCents: number;
    };

export interface PosterCancelSplitInput {
  job: PosterCancelSplitJob;
  /** A10: a Declutter seller's backing out cancelled this setup job (declutter_order_jobs.seller_fault_refund_id). */
  sellerFault: boolean;
  /** The late-cancellation fee owed to the Helpr(s), in cents. */
  cancellationFeeCents: number;
  /** A crew's block fees (closed spots) owed from this payment, in cents. */
  blockFeeCents: number;
  charge: PosterCancelCharge;
}

export type PosterCancelSplit =
  | {
      state: "hold";
      /** What the sweep captures: the fees owed, never more than the hold. */
      captureCents: number;
      /** The rest of the hold, released back to the card. */
      backCents: number;
      /** The fees are more than the hold: a gift must pay the rest (the sweep's Q1806 path). */
      feesExceedHold: boolean;
    }
  | {
      state: "captured";
      /** refundToPayerCents with this cancel's kept amounts. */
      split: RefundToPayerResult;
      /** What goes back to the card now (never negative). */
      backCents: number;
      /** The fee the poster paid at checkout that this cancel keeps (posterCancelKeptFeeCents). */
      serviceFeeCents: number;
      /** An unfilled or ban-ended series visit: its service fee comes back too. */
      fullSeriesRefund: boolean;
      /** The fees owed fit in what the card still holds (else a gift pays: the sweep's Q1806 path). */
      feesFitCard: boolean;
    };

function cents(n: number | null | undefined): number {
  const v = Math.round(Number(n ?? 0));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * How a poster's cancel splits the job's card payment. Pure: the same inputs
 * always give the same answer, which is the whole point.
 */
export function posterCancelSplit(i: PosterCancelSplitInput): PosterCancelSplit {
  const feesCents = cents(i.cancellationFeeCents) + cents(i.blockFeeCents);
  if (i.charge.state === "hold") {
    const holdCents = cents(i.charge.capturableCents);
    // No fee: the whole hold is cancelled and released (captureCents 0).
    const captureCents = feesCents > 0 ? Math.min(feesCents, holdCents) : 0;
    return {
      state: "hold",
      captureCents,
      backCents: Math.max(0, cents(i.charge.amountCents) - captureCents),
      feesExceedHold: feesCents > holdCents,
    };
  }
  const c = i.charge;
  const fullSeriesRefund = refundsSeriesVisitInFull(i.job);
  // A poster-fee job keeps no service fee, only Stripe's real fee
  // (posterCancelKeptFeeCents, Q2082 slice 4); any other job keeps the fee
  // its poster paid. A10: a seller-fault Declutter setup job keeps no card
  // fee (the seller owes it); its setup fee is still kept (Q1674).
  const serviceFeeCents = posterCancelKeptFeeCents(i.job);
  const split = refundToPayerCents({
    capturedCents: c.capturedCents,
    actualFeeCents: i.sellerFault ? 0 : c.actualFeeCents,
    customerFeeCents: fullSeriesRefund || i.sellerFault ? 0 : serviceFeeCents,
    setupFeeCents: setupFeeKeptCents(i.job),
    otherKeptCents: feesCents,
    alreadyRefundedCents: c.alreadyRefundedCents,
    taxCents: c.taxCents,
  });
  return {
    state: "captured",
    split,
    backCents: split.refundCents,
    serviceFeeCents,
    fullSeriesRefund,
    feesFitCard: feesCents <= cents(c.capturedCents) - cents(c.alreadyRefundedCents),
  };
}
