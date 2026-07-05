// posterFees — client mirror of the tiered SERVICE FEE a poster pays at
// checkout, so the Post-a-Task form shows a total that exactly matches what the
// `create-payment` edge function will charge.
//
// The poster's own subscription tier sets the service-fee percentage, using the
// SAME 12 / 10 / 8 / 6 ladder the helper commission uses (a Business account
// pays 6% on both sides) — sourced from `TIER_PERKS` in `subscriptionTiers.ts`.
// The collected fee is floored at Stripe's real processing cost on the whole
// transaction so a tiny job can never lose the platform money to fees.
//
// The authority that actually charges this lives in the Deno edge module
// `supabase/functions/_shared/posterFees.ts`. `posterFees.parity.test.ts` fails
// the build if this client mirror and that edge authority ever diverge.

import { TIER_PERKS, toSubscriptionTier } from "./subscriptionTiers";
import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees";

/**
 * Resolve the poster's service-fee percent from their raw `subscription_tier`
 * and `subscription_expires_at`. An expired paid tier reverts to the free rate,
 * mirroring the edge authority so the shown fee matches the charged fee.
 */
export function posterFeePercentForTier(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  // Normalize case before resolving so "PRO" matches "pro". The edge authority
  // (`_shared/helperFees.ts` `feePercentForTier`) lowercases its input, but the
  // client `toSubscriptionTier` exact-matches — without this the two runtimes
  // diverge on a mixed-case tier string and `posterFees.parity.test.ts` fails.
  const normalized = (rawTier ?? "").toLowerCase();
  return TIER_PERKS[toSubscriptionTier(expired ? "free" : normalized)].platformFeePercent;
}

/**
 * The service fee to charge the poster, in cents: the poster's tier percentage
 * of the job budget, floored at Stripe's real processing cost on the entire
 * transaction (budget + this fee + any other charged line items). Mirrors the
 * edge authority.
 *
 * @param budgetCents        job budget in cents
 * @param feePercent         the poster's resolved tier fee percent (12/10/8/6)
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
