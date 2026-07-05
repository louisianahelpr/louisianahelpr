// stripeFees — client mirror of what Stripe's card processing costs the platform,
// so any UI that explains a non-refundable service fee can derive from one number
// rather than a hand-typed "2.9% + $0.30".
//
// The authority that actually withholds this in refund paths lives in the Deno
// edge module `supabase/functions/_shared/stripeFees.ts`. This file duplicates
// only the constants (the edge runtime can't import React modules and vice-versa),
// and `stripeFees.parity.test.ts` fails the build if the two ever diverge.

/** Stripe's percentage cut of a successful card charge (2.9%). */
export const STRIPE_PCT = 0.029;

/** Stripe's fixed per-charge fee, in cents ($0.30). */
export const STRIPE_FLAT_CENTS = 30;

/**
 * What Stripe kept (and will NOT refund) on a successful card charge of
 * `amountCents`, in cents: 2.9% + $0.30, rounded to the nearest cent. Returns 0
 * for a non-positive amount. Mirrors the edge authority.
 */
export function stripeProcessingCostCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * STRIPE_PCT) + STRIPE_FLAT_CENTS;
}
