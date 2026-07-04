// instantPayoutFee — single source of truth for the fee charged when a helper
// cashes out early via Stripe instant payout, for the Deno edge runtime.
//
// The fee is a flat percentage of the amount being paid out — no fixed
// component, no minimum. `instant-payout/index.ts` is the only path that moves
// this money, and it derives the fee from here so the number that leaves the
// helper's balance always equals the number the UI advertises.
//
// This MUST stay in lock-step with the client mirror in
// `src/lib/instantPayoutFee.ts` (the value the React UI renders its fee copy
// from). The edge runtime is Deno and cannot import that React module, so the
// rate is duplicated there and a vitest parity test
// (`src/lib/instantPayoutFee.parity.test.ts`) fails the build if the two drift.

/** Flat percent of the gross payout kept as the instant-payout fee. */
export const INSTANT_PAYOUT_FEE_PERCENT = 3;

/**
 * Instant-payout fee in CENTS for a given gross payout in cents. A flat
 * percentage, rounded to the nearest cent — no fixed add-on, no floor.
 */
export function computeInstantPayoutFeeCents(grossCents: number): number {
  if (!(grossCents > 0)) return 0;
  return Math.round(grossCents * (INSTANT_PAYOUT_FEE_PERCENT / 100));
}
