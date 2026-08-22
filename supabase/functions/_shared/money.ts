/**
 * Money formatting for notification copy, mirroring `src/lib/format.ts`.
 *
 * Edge functions run on Deno and cannot import from `src/`, but the rule they
 * have to obey is the same one the app obeys: a card/row shows WHOLE DOLLARS,
 * and a figure that is a PAYOUT to someone rounds DOWN so the notification
 * never promises more than the amount that actually lands ($83.60 must read
 * "$83", never "$84").
 *
 * Use `formatPayoutDollars` for take-home / net / payout copy shown to a user.
 * Leave `.toFixed(2)` in place for internal ops + Slack alerts and for
 * breakdown fragments that have to visibly add up (a fee-deduction note) —
 * the same split `formatPriceExact` covers on the client.
 */
export function formatPayoutDollars(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  return Math.floor(amount).toLocaleString("en-US");
}

/** Cents-denominated sibling, for the handlers that carry Stripe cents. */
export function formatPayoutCents(cents: number): string {
  if (!Number.isFinite(cents)) return "0";
  return formatPayoutDollars(cents / 100);
}
