// instantPayoutFee — client mirror of the instant-payout fee so every UI string
// that mentions it is derived from one number, never a hand-typed "3%".
//
// The authority that actually moves money lives in the Deno edge module
// `supabase/functions/_shared/instantPayoutFee.ts`. This file duplicates only
// the rate (the edge runtime can't import React modules and vice-versa), and
// `instantPayoutFee.parity.test.ts` fails the build if the two ever diverge.

/** Flat percent of the gross payout kept as the instant-payout fee. */
export const INSTANT_PAYOUT_FEE_PERCENT = 3;

/** Short label for inline copy, e.g. "3% fee". */
export function instantPayoutFeeLabel(): string {
  return `${INSTANT_PAYOUT_FEE_PERCENT}% fee`;
}
