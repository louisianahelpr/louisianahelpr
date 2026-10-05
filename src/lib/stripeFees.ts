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
 * What the Helpr receives of the urgent bonus: ALL of it (owner MQ11 / CC-003,
 * Q362): the poster pays the bonus's card fee on top (`urgentBonusCardFeeCents`).
 * The name is kept so every earnings surface still calls this ONE definition and
 * the amount a Helpr is SHOWN equals the amount the edge transfers. DOLLARS in
 * and out. Returns 0 for a non-positive/absent fee. Mirrors the edge authority.
 */
export function netUrgentFeeDollars(urgentFeeDollars: number | null | undefined): number {
  const cents = Math.round((urgentFeeDollars ?? 0) * 100);
  if (!(cents > 0)) return 0;
  return cents / 100;
}

/**
 * The card fee the poster pays on top of an urgent bonus, in cents: the
 * smallest whole-cent `fee` with `fee >= stripePercentCostCents(urgent + fee)`
 * (bundled: percentage only). Mirrors the edge authority, which create-payment
 * charges as its own line.
 */
export function urgentBonusCardFeeCents(urgentCents: number): number {
  if (!(urgentCents > 0)) return 0;
  let fee = Math.ceil((urgentCents * STRIPE_PCT) / (1 - STRIPE_PCT));
  while (fee > 0 && fee - 1 >= stripePercentCostCents(urgentCents + fee - 1)) fee--;
  while (fee < stripePercentCostCents(urgentCents + fee)) fee++;
  return fee;
}
