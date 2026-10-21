/**
 * Raising a Declutter delivery's pay (spec row 40, Q1929; migration
 * 20261021130506_declutter_delivery_raise_pay). The raise is its own card
 * payment, so the buyer pays that payment's card cost: what Stripe keeps on a
 * card charge (2.9% + 30c), grossed up so the whole raise reaches the
 * delivery's pay.
 *
 * The client mirror of `declutter_delivery_raise_card_fee_cents` and
 * `declutter_delivery_raise_rules`. Zero imports on purpose: the PGlite proof
 * (src/test/pglite/declutterDeliveryRaise.pglite.mjs) imports this file and
 * compares it with the SQL for every allowed raise.
 */

/** At least $5 a raise. */
export const RAISE_MIN_CENTS = 500;
/** Whole dollars. */
export const RAISE_STEP_CENTS = 100;
/** At most $150 raised in all on one delivery. */
export const RAISE_MAX_TOTAL_CENTS = 15000;

/** The card fee on a raise of `raiseCents`, in cents (0 for nothing). */
export function raiseCardFeeCents(raiseCents: number): number {
  if (!(raiseCents > 0)) return 0;
  return Math.ceil(((raiseCents + 30) * 1000) / 971) - raiseCents;
}
