/**
 * The words for what a cancelled or expired job gives back, in ONE place so the Help center and Receipts cannot drift
 * apart again (owner UI audit 2026-11-09, F089 / F105; owner decision the same day).
 *
 * Measured on prod: jobs that expired with nobody hired (5d43debf, 9c321fed, 375000de, 1251173a, 53c98775) were
 * refunded by void-cancelled-payments less the card processing cost (payment_refunds.reason), while Help said
 * "Cancelling is free before you accept someone". Owner 2026-11-09: an expired, never-hired job KEEPS the card fee
 * (never absorb), and members may be told so in these plain words. A card that was only held (card_hold_at_post) is
 * released whole, so nothing is kept there: hence "if your card was already charged".
 *
 * Guard: src/test/helpDisputeRuleOneVoice.test.ts (Help and Receipts both use these), membersSeeNoFeeWords allowlist.
 */
export const CARD_COST_NOT_REFUNDED = "Card processing cost isn't refunded.";

export const NO_HIRE_REFUND =
  "If no one is hired, you get your money back, less the small card processing cost if your card was already charged.";

/** What came back on a poster's cancelled job, from the Receipts numbers (usePosterJobRefund). */
export interface JobRefund {
  refundedCents: number;
  /** What the card kept as the card processing cost alone; 0 when something else was kept too (see cardCostKeptCents). */
  keptCents: number;
}

/**
 * The kept charge counts as "the card processing cost" ONLY when nothing else could be in it (lh-money review of
 * F105): a kept one-time setup fee (onboarding_fee_amount, Receipts names it separately), a cancellation fee kept for
 * the Helpr's time or the seller's fault (cancellation_fee), or a crew block fee. With any of those it returns 0, so
 * the words say only the refunded amount, never call another fee a card cost.
 */
export function cardCostKeptCents(
  job: { onboarding_fee_amount?: number | null; cancellation_fee?: number | null } | undefined,
  keptCents: number,
  hasBlockFee: boolean,
): number {
  if (!job || hasBlockFee) return 0;
  if (Number(job.onboarding_fee_amount ?? 0) > 0 || Number(job.cancellation_fee ?? 0) > 0) return 0;
  return Math.max(0, keptCents);
}

/** The refund words when the amounts are not known (loading, no read): a refund was sent, never that it was whole. */
export const REFUND_SENT = "Refund sent to your card";

/**
 * F105 (owner UI audit 2026-11-09): the cancelled card's refund words, with the same numbers as Receipts.
 * "$28.83 refunded · Card processing cost isn't refunded." when the card kept something and nobody was owed for their
 * time; "$28.83 refunded" when it came back whole, or when a late-cancel amount (said by its own words) was kept.
 */
export function refundedWords(refund: JobRefund | null | undefined, lateFeeKept = false): string {
  if (!refund || refund.refundedCents <= 0) return REFUND_SENT;
  const back = `$${(refund.refundedCents / 100).toFixed(2)} refunded`;
  return refund.keptCents > 0 && !lateFeeKept ? `${back} · ${CARD_COST_NOT_REFUNDED}` : back;
}
