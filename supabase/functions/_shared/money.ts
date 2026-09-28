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
  // Through the transfer's own rule (whole cent first, then down to the
  // dollar), so float noise like 122.99999999999999 — a $410 job split three
  // ways at 10% — reads "$123", the dollar amount that actually lands.
  return Math.floor(roundPayoutDownCents(amount * 100) / 100).toLocaleString("en-US");
}

/** Cents-denominated sibling, for the handlers that carry Stripe cents. */
export function formatPayoutCents(cents: number): string {
  if (!Number.isFinite(cents)) return "0";
  return formatPayoutDollars(cents / 100);
}

/**
 * THE Helpr payout rounding rule (owner, 2026-09-27, Q236): every transfer to
 * a Helpr is a WHOLE dollar, rounded DOWN, and the platform keeps the cents.
 * $41.87 owed → 4100 cents transferred; the 87 cents stay in the platform
 * balance.
 *
 * This is the ONE place that rule lives. Every `stripe.transfers.create` that
 * pays a Helpr for a job (release-payout, process-scheduled-payouts, the
 * dispute split, the admin Quick Release, cancellation-fee payouts) sets its
 * `amount` through it — `src/test/helprPayoutRoundedDown.test.ts` fails CI on
 * one that does not.
 *
 * Integer cents in, integer cents out. The input is rounded to a whole cent
 * first so float noise (4186.9999…) cannot knock a dollar off. Zero and
 * negative inputs come back as-is (never raised), so a caller's existing
 * `<= 0` refusal still fires.
 */
export function roundPayoutDownCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  const whole = Math.round(cents);
  if (whole <= 0) return whole;
  return Math.floor(whole / 100) * 100;
}
