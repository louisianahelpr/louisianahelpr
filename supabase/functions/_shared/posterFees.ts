// posterFees — single source of truth for the tiered SERVICE FEE a poster pays
// at checkout, for the Deno edge runtime.
//
// The poster's own subscription tier sets the service-fee percentage, using the
// SAME 12 / 11 / 10 / 8 / 6 ladder as the helper-side commission (a Business
// account pays 6% on both sides). We reuse `feePercentForTier` from
// `helperFees.ts` so there is exactly one fee ladder in the edge runtime and
// one parity test (`src/lib/helperFees.parity.test.ts`) guarding it against
// `subscriptionTiers.ts`.
//
// Unlike the helper commission (resolved at PAYOUT because no helper is assigned
// when escrow is funded), the poster IS known at checkout, so their tier is
// resolved from their live profile at the moment they fund the job.
//
// The floor: Stripe keeps 2.9% + $0.30 of every captured charge and never
// returns it on a refund. On a very small job the raw tier percentage of the
// budget can come out below what Stripe costs the platform on the whole
// transaction — which would put us underwater on fees. `posterServiceFeeCents`
// floors the collected fee at Stripe's real processing cost so the platform can
// never lose money to fees, honoring the core money-safety rule for this app.
//
// This MUST stay in lock-step with the client mirror `src/lib/posterFees.ts`;
// `src/lib/posterFees.parity.test.ts` fails the build if the two diverge.

import { feePercentForTier } from "./helperFees.ts";
import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees.ts";

/**
 * Resolve the poster's service-fee percent from their raw `subscription_tier`
 * and `subscription_expires_at`. An expired paid tier reverts to the free rate
 * even if the `expire-subscriptions` cron hasn't nulled the column yet, so a
 * lapsed Pro poster is never charged the discounted rate.
 */
export function posterFeePercentForTier(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return feePercentForTier(expired ? "free" : rawTier);
}

/**
 * The service fee to charge the poster, in CENTS. It is the poster's tier
 * percentage of the job budget, floored at Stripe's real processing cost on the
 * ENTIRE transaction (budget + this fee + any other charged line items such as
 * an urgent tip or the one-time onboarding fee), so the platform never nets a
 * loss on fees for a tiny job.
 *
 * @param budgetCents        job budget in cents (the taxable/escrowed amount)
 * @param feePercent         the poster's resolved tier fee percent (12/11/10/8/6)
 * @param otherChargeCents   sum of every OTHER charged line item, in cents
 */
export function posterServiceFeeCents(
  budgetCents: number,
  feePercent: number,
  otherChargeCents = 0,
): number {
  const tierFeeCents = Math.round((budgetCents * feePercent) / 100);
  // The floor must cover Stripe's cost on the WHOLE charge, and the fee itself
  // is part of that charge — a fixed point `fee ≥ stripeCost(base + fee)`. The
  // old code measured the floor against `base + tierFeeCents`, so when the floor
  // wins (floor > tierFee) the real total is bigger than what was measured and
  // the collected fee undershoots Stripe's cost by ~1¢ — exactly the "lose money
  // to fees" case the floor exists to prevent. Invert the algebra for a starting
  // guess, then verify against the real round-based cost and nudge up to absorb
  // any integer-rounding slack, so the invariant holds exactly.
  const base = budgetCents + otherChargeCents;
  let floorCents = base > 0 ? Math.ceil((base * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT)) : 0;
  while (floorCents > 0 && floorCents < stripeProcessingCostCents(base + floorCents)) floorCents++;
  return Math.max(tierFeeCents, floorCents);
}
