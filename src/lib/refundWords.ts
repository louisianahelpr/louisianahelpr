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
