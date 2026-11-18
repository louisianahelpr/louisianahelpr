/**
 * A Declutter price in whole or two-decimal dollars ("$40" / "$40.50"). Dependency-free on purpose (Q178, 11-18 train):
 * the payout words (payoutWords.ts) need only this from distance.ts, and distance.ts imports the i18n reader, so through
 * it Profile's Earnings tab pulled the whole signed-in-deep chunk and its closure (+208 KB gz, one more round).
 * distance.ts re-exports it, so every existing import keeps working.
 */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
