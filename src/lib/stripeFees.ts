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

/**
 * Stripe's PERCENTAGE-only cost (2.9%, no flat), in cents, for a line item that
 * rides BUNDLED inside a larger charge rather than as its own standalone charge.
 * The $0.30 flat is levied ONCE per transaction and is already borne by the
 * primary legs (job budget + service fee), so a bundled add-on like the urgent
 * fee only carries the marginal percentage. Mirrors the edge authority. Returns
 * 0 for a non-positive amount.
 */
export function stripePercentCostCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * STRIPE_PCT);
}

/**
 * The urgent fee a helper actually nets after the urgent fee covers its OWN
 * marginal Stripe processing cost. The urgent fee is charged to the poster
 * bundled into the escrow checkout and passes through to the helper; this nets
 * out only the bundled marginal cost (2.9%, NOT the once-per-transaction flat)
 * so the platform never subsidizes card processing on the urgent fee. Input and
 * output are in DOLLARS so it slots directly into the
 * `budget − commission + urgentFee` take-home formula used across every earnings
 * display. Returns 0 for a non-positive/absent fee. This is the ONE definition
 * every earnings surface must call, so the amount a helper is SHOWN always
 * equals the amount the edge transfers. Mirrors the edge authority.
 */
export function netUrgentFeeDollars(urgentFeeDollars: number | null | undefined): number {
  const cents = Math.round((urgentFeeDollars ?? 0) * 100);
  if (!(cents > 0)) return 0;
  return (cents - stripePercentCostCents(cents)) / 100;
}
