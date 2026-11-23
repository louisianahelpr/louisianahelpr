// posterFees — client mirror of the SERVICE FEE a poster pays at checkout, so
// the Post-a-Task form shows a total that exactly matches what the
// `create-payment` edge function will charge.
//
// OWNER DECISION, 2026-10-11: posters pay no platform percentage on any tier;
// the service fee is Stripe's real card-processing cost on the whole charge and
// nothing more ("Poster pays Stripe's fee"). The Helpr commission (tier ladder,
// deducted from the payout) is unchanged and is NOT read here.
//
// The authority that actually charges this lives in the Deno edge module
// `supabase/functions/_shared/posterFees.ts`. `posterFees.parity.test.ts` fails
// the build if this client mirror and that edge authority ever diverge.

import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees";

/** The platform percentage a poster pays: none (owner, 2026-10-11). */
export const POSTER_SERVICE_FEE_PERCENT = 0;

/** The one short description of the fee, wherever the poster sees it. */
export const POSTER_SERVICE_FEE_DESCRIPTION = "Covers card processing";

/**
 * The service fee to charge the poster, in cents: Stripe's real processing
 * cost on the entire transaction (budget + this fee + any other charged line
 * items). Mirrors the edge authority.
 *
 * @param budgetCents        job budget in cents
 * @param otherChargeCents   sum of every OTHER charged line item, in cents
 * @param prepaidCostCents   card cost already collected by another line (Q362:
 *                           the urgent bonus's own card fee). Included in
 *                           `otherChargeCents` too; the fee is lowered by it
 *                           so the poster never pays the same card cost twice.
 */
export function posterCardCostFeeCents(
  budgetCents: number,
  otherChargeCents = 0,
  prepaidCostCents = 0,
): number {
  // The fee is part of the charge it pays for: solve `fee >= stripeCost(base +
  // fee)` in closed form, then nudge to absorb integer rounding.
  const base = budgetCents + otherChargeCents;
  let feeCents = base > 0 ? Math.ceil((base * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT)) : 0;
  while (feeCents > 0 && feeCents < stripeProcessingCostCents(base + feeCents)) feeCents++;
  // Q362: a line that already pays its own card cost covers that part.
  const prepaid = Math.max(0, prepaidCostCents);
  if (prepaid > 0 && feeCents > 0) {
    feeCents = Math.max(0, feeCents - prepaid);
    while (feeCents > 0 && feeCents - 1 + prepaid >= stripeProcessingCostCents(base + feeCents - 1)) feeCents--;
    while (feeCents + prepaid < stripeProcessingCostCents(base + feeCents)) feeCents++;
  }
  return feeCents;
}

/**
 * Louisiana law caps what a gift card buyer may be charged on top of the card:
 * La. R.S. 51:1423(B)(2) makes it unlawful to sell a gift certificate with "a
 * service fee", except "a one-time handling fee, which shall not exceed one
 * dollar per gift certificate" (https://legis.la.gov/Legis/Law.aspx?d=285608,
 * read 2026-11-23). (E) makes a violation a deceptive and unfair trade practice.
 */
export const GIFT_CARD_HANDLING_FEE_CAP_CENTS = 100;

/**
 * The one-time handling fee a gift card buyer pays on top of the face value, in
 * cents: the card's own card cost, but never more than the $1 the law allows.
 * Louisiana Helpr absorbs any card cost above $1 (from a ~$23 gift up).
 */
export function giftCardHandlingFeeCents(faceCents: number): number {
  return Math.min(posterCardCostFeeCents(faceCents), GIFT_CARD_HANDLING_FEE_CAP_CENTS);
}
