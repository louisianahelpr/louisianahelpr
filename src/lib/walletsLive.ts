/**
 * Board 186 (wallet pay), owner decision 2026-10-21: no embedded wallet buttons before launch; the pay
 * button says, in one line, how the next (Stripe-hosted) page lets the poster pay, naming ONLY the wallets
 * that are live on the account.
 *
 * Measured 2026-10-21 (read-only Stripe API, live, default configuration pmc_1RQbBF…): apple_pay on, and
 * google_pay on (available true, value on) after an earlier read the same day had it off (Q2270, #3468).
 * Change this list only with a fresh live read of that configuration; src/test/walletPayLine.test.ts pins
 * it so it cannot drift by accident.
 */
export const LIVE_WALLETS: readonly string[] = ["Apple Pay", "Google Pay"];

/** "Next: pay by card, Apple Pay, Google Pay or bank on a secure page." (job checkouts allow card, Link and US bank). */
export function payNextLine(wallets: readonly string[] = LIVE_WALLETS): string {
  const ways = ["card", ...wallets];
  return `Next: pay by ${ways.join(", ")} or bank on a secure page.`;
}
