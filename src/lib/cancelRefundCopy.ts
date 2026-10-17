import { formatPriceExact } from "@/lib/format";

/**
 * The confirmation a poster reads after cancelling a job, naming what happens
 * to their money. Pulled out of CancellationDialog so every branch is tested
 * (lh-money-escrow review of 7166349cd, #4: the legacy late-fee branch said
 * "the rest returns to your card" while void-cancelled-payments also keeps the
 * service fee paid at checkout).
 *
 * - never funded: nothing was charged, nothing to refund;
 * - flat model (roadmap F3, stamped at funding): the poster paid the job price
 *   only, so the refund is that payment less the card-processing fee Stripe
 *   keeps (refundToPayerCents);
 * - legacy (paid before F3): the budget comes back and the card-cost service
 *   fee charged at checkout is kept.
 * `keptFeeSentence` is the one-time setup-fee sentence (empty when none).
 */
export function cancelRefundToast(args: {
  wasFunded: boolean;
  appliedFee: number;
  flatModel: boolean;
  keptFeeSentence: string;
}): string {
  const { wasFunded, appliedFee, flatModel, keptFeeSentence } = args;
  if (!wasFunded) {
    return "Job cancelled. Your checkout was never completed, so you were never charged — there's nothing to refund.";
  }
  if (appliedFee > 0) {
    const rest = flatModel
      ? "the rest, less the card-processing fee Stripe keeps, returns to your card."
      : "the rest, less the service fee you paid at checkout, returns to your card.";
    return `Job cancelled. The $${formatPriceExact(appliedFee)} cancellation fee applies — ${rest}${keptFeeSentence}`;
  }
  return flatModel
    ? `Job cancelled — your payment returns to your card, less the card-processing fee Stripe keeps.${keptFeeSentence}`
    : `Job cancelled — your job budget returns to your card; the service fee isn't refundable.${keptFeeSentence}`;
}
