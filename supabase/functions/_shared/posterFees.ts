// posterFees — single source of truth for the SERVICE FEE a poster pays at
// checkout, for the Deno edge runtime.
//
// OWNER DECISION, 2026-10-11 (pop-up): "remove the service fee for posters bc
// right now I'm worried no one will post when they can easily post for free on
// Facebook." The poster pays NO platform percentage on any tier. What they do
// pay is Stripe's real card-processing cost on the charge ("Poster pays
// Stripe's fee"), so the platform never loses money to fees on a checkout.
// New checkouts only: a job already paid keeps the fee stamped on it
// (jobs.customer_fee_amount), and every refund path reads that stored amount,
// never a recomputed one.
//
// The Helpr-side commission (12/11/10/9/8 by tier, deducted from the payout)
// is UNCHANGED and lives in `helperFees.ts`. The poster fee and the Helpr
// commission are no longer the same number: this module imports nothing from
// the tier ladder on purpose, and `src/test/posterCheckoutChargesCardCostOnly
// .test.ts` fails if any poster checkout path prices a tier percent again.
//
// The fee: Stripe keeps 2.9% + $0.30 of every captured charge and never
// returns it on a refund. The fee covers Stripe's cost on the ENTIRE
// transaction, the fee included (a fixed point `fee >= stripeCost(base +
// fee)`; the closed form can land 1¢ above the exact minimum), so the
// platform nets >= 0 on fees.
//
// It is labelled "Service fee" with "covers card processing" wherever the
// poster sees it. It is NOT a card surcharge: it is charged on every checkout,
// whatever the payment method.
//
// This MUST stay in lock-step with the client mirror `src/lib/posterFees.ts`;
// `src/lib/posterFees.parity.test.ts` fails the build if the two diverge.

import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees.ts";

/**
 * The platform percentage a poster pays on top of the budget: none (owner,
 * 2026-10-11). Stamped as `jobs.platform_fee_percent` (the poster-side column)
 * and sent as the PaymentIntent's `customer_fee_percent` metadata, so a job's
 * own row says which pricing it was charged under.
 */
export const POSTER_SERVICE_FEE_PERCENT = 0;

/** The one short description of the fee, on the Stripe line and in the app. */
export const POSTER_SERVICE_FEE_DESCRIPTION = "Covers card processing";

/**
 * The service fee to charge the poster, in CENTS: Stripe's real processing
 * cost on the ENTIRE transaction (budget + this fee + every other charged line
 * item, such as the urgent bonus, its card fee, the one-time setup fee or sales
 * tax when it is known), and nothing more. No tier, no percentage.
 *
 * @param budgetCents        job budget in cents
 * @param otherChargeCents   sum of every OTHER charged line item, in cents
 * @param prepaidCostCents   card cost already collected by another line (Q362:
 *                           the urgent bonus's own card fee). Included in
 *                           `otherChargeCents` too; the floor is lowered by it
 *                           so the poster never pays the same card cost twice.
 */
export function posterCardCostFeeCents(
  budgetCents: number,
  otherChargeCents = 0,
  prepaidCostCents = 0,
): number {
  // The fee is part of the charge it pays for, so solve the fixed point
  // `fee >= stripeCost(base + fee)`: invert the algebra for a starting guess,
  // then verify against the real round-based cost and nudge up to absorb any
  // integer-rounding slack, so the invariant holds exactly.
  const base = budgetCents + otherChargeCents;
  let feeCents = base > 0 ? Math.ceil((base * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT)) : 0;
  while (feeCents > 0 && feeCents < stripeProcessingCostCents(base + feeCents)) feeCents++;
  // Q362: a line that already pays its own card cost (the urgent bonus card
  // fee) covers that part. Re-solve with it: the smallest fee with
  // `fee + prepaid >= stripeCost(base + fee)`, so the platform stays covered
  // and the bonus's card cost is never charged twice.
  const prepaid = Math.max(0, prepaidCostCents);
  if (prepaid > 0 && feeCents > 0) {
    feeCents = Math.max(0, feeCents - prepaid);
    while (feeCents > 0 && feeCents - 1 + prepaid >= stripeProcessingCostCents(base + feeCents - 1)) feeCents--;
    while (feeCents + prepaid < stripeProcessingCostCents(base + feeCents)) feeCents++;
  }
  return feeCents;
}
