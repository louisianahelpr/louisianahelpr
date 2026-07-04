// instantPayoutFee — client mirror of the instant-payout fee so every UI string
// that mentions it is derived from one number, never a hand-typed "3%".
//
// The authority that actually moves money lives in the Deno edge module
// `supabase/functions/_shared/instantPayoutFee.ts`. This file duplicates only
// the rate (the edge runtime can't import React modules and vice-versa), and
// `instantPayoutFee.parity.test.ts` fails the build if the two ever diverge.

/** Flat percent of the gross payout kept as the instant-payout fee. */
export const INSTANT_PAYOUT_FEE_PERCENT = 3;

/**
 * Minimum available balance (in cents) required to use instant payout — mirrors
 * the edge authority. Below this the UI disables instant and offers the free
 * standard payout. See the edge module for the Stripe-cost rationale.
 */
export const INSTANT_PAYOUT_MIN_CENTS = 2500;

/** Short label for inline copy, e.g. "3% fee". */
export function instantPayoutFeeLabel(): string {
  return `${INSTANT_PAYOUT_FEE_PERCENT}% fee`;
}

/** The minimum-cashout threshold as a display string, e.g. "$25". */
export function instantPayoutMinLabel(): string {
  const dollars = INSTANT_PAYOUT_MIN_CENTS / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
