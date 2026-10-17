import { formatPriceExact } from "@/lib/format";

/**
 * Whether a gift card paid toward this job, read right after the cancel:
 * - "redeemed": the gift paid (all or part of) the job. void-cancelled-payments
 *   gives it back to the gift balance (restore_gift_card_for_job) within the hour;
 * - "reserved": the gift was set aside for a checkout that never completed;
 *   that sweep's Part C un-reserves it;
 * - "none": no gift on this job;
 * - "unknown": the read failed, so neither the card copy nor the gift copy is safe.
 */
export type GiftOnJob = "none" | "redeemed" | "reserved" | "unknown";

/**
 * What a gift_cards read for the job says (rows with status 'redeemed' or
 * 'reserved' that the poster can see; RLS "Gift cards are party-only").
 * A read error is "unknown", never "none": the card copy on a gift-paid job
 * is the defect this exists for (lh-money-escrow design review of Q1806,
 * 2026-10-17: on a failed read show neutral copy, never the card copy).
 */
export function giftOnJobFromRead(rows: Array<{ status: string | null }> | null, error: unknown): GiftOnJob {
  if (error) return "unknown";
  const statuses = (rows ?? []).map((r) => r.status);
  if (statuses.includes("redeemed")) return "redeemed";
  if (statuses.includes("reserved")) return "reserved";
  return "none";
}

/**
 * The confirmation a poster reads after cancelling a job, naming what happens
 * to their money. Pulled out of CancellationDialog so every branch is tested
 * (lh-money-escrow review of 7166349cd, #4: the legacy late-fee branch said
 * "the rest returns to your card" while void-cancelled-payments also keeps the
 * service fee paid at checkout).
 *
 * - never funded: nothing was charged, nothing to refund (and a gift set aside
 *   for that checkout goes back);
 * - flat model (roadmap F3, stamped at funding): the poster paid the job price
 *   only, so the refund is that payment less the card-processing fee Stripe
 *   keeps (refundToPayerCents);
 * - legacy (paid before F3): the budget comes back and the card-cost service
 *   fee charged at checkout is kept;
 * - a GIFT paid toward the job (Q?gift-cancel-copy): the gift goes back to the
 *   gift balance, and only a card payment comes back to the card. With a late
 *   fee the split between gift and card is Q1806's to settle, so the copy says
 *   "up to" the fee and promises the exact amounts, which the restore notice
 *   and the refund notice send.
 * `keptFeeSentence` is the one-time setup-fee sentence (empty when none).
 */
export function cancelRefundToast(args: {
  wasFunded: boolean;
  appliedFee: number;
  flatModel: boolean;
  keptFeeSentence: string;
  gift?: GiftOnJob;
}): string {
  const { wasFunded, appliedFee, flatModel, keptFeeSentence } = args;
  const gift = args.gift ?? "none";
  if (!wasFunded) {
    if (gift === "reserved") {
      return "Job cancelled. Your checkout was never completed, so your card was never charged, and the gift you set aside goes back to your gift balance within the hour.";
    }
    return "Job cancelled. Your checkout was never completed, so you were never charged — there's nothing to refund.";
  }
  if (gift === "unknown") {
    return `Job cancelled. We'll send you a note with exactly what comes back to you within the hour.${keptFeeSentence}`;
  }
  if (gift === "redeemed") {
    const cardKeeps = flatModel ? "the card-processing fee Stripe keeps" : "the service fee you paid at checkout";
    if (appliedFee > 0) {
      return `Job cancelled. Your gift goes back to your gift balance and any card payment returns to your card, less up to the $${formatPriceExact(appliedFee)} cancellation fee and ${cardKeeps}. We'll send you the exact amounts.${keptFeeSentence}`;
    }
    return `Job cancelled — your gift goes back to your gift balance within the hour, and any card payment returns to your card, less ${cardKeeps}.${keptFeeSentence}`;
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
