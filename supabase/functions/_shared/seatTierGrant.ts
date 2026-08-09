// seatTierGrant — the single definition of what a paid business seat plan
// actually BUYS, shared by the Stripe webhook and the reconciliation poll.
//
// A seat plan's headline benefit is a lower commission (and earlier job access)
// than the standard 12%. That benefit is delivered by writing a membership rung
// onto the OWNER's profiles.subscription_tier, because those rungs already
// carry exactly the fee + early-access values the /for-business cards advertise:
//
//     crew       → basic   11% fee,  5-min early access
//     team       → pro     10% fee, 10-min early access
//     enterprise → elite    8% fee, 20-min early access
//     starter    → null    12% fee,  0-min (the standard — i.e. no grant)
//
// (Granting 'business' instead would give every paid tier a flat 6% — cheaper
// than any tier we advertise, including Enterprise.)
//
// WHY THIS MODULE EXISTS. The mapping used to live inline inside
// check-business-seat-subscription, whose ONLY caller was a React page. So the
// discount was applied when a customer happened to open a business page in the
// app — not when they paid. A Crew owner paying $20/mo who worked from the
// normal dashboard was charged the standard 12% indefinitely: paying for a
// discount they never received. The mirror image applied on cancellation, where
// a lapsed owner kept the discount until they next visited.
//
// The webhook now performs the grant/revoke directly off Stripe's
// customer.subscription.* events, so it lands the moment money moves and is
// removed the moment the plan ends. The poll remains as a reconciliation path.
// Both import from here so the ladder can never drift between them.

/** Stripe product id → seat tier key. */
export const SEAT_PRODUCT_TO_TIER: Record<string, string> = {
  prod_UP8XCpifCuHO1y: "crew",
  prod_UP8Xdu0Z55uyyZ: "team",
  prod_UP8XIjp23K25YG: "enterprise",
};

/** Seat tier → the membership rung that carries its advertised fee. */
export const SEAT_TIER_TO_SUBSCRIPTION: Record<string, string | null> = {
  starter: null,
  crew: "basic",
  team: "pro",
  enterprise: "elite",
};

/**
 * Stripe subscription statuses that should KEEP the discount active.
 *
 * Deliberately narrow. `past_due` and `unpaid` are excluded: the customer is no
 * longer current, so they fall back to the standard 12% rather than continuing
 * to receive a discount they have stopped paying for. `trialing` is included
 * because a trial is an intentional grant of the benefit.
 */
export const SEAT_ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * Resolve the membership rung a seat subscription should grant its owner.
 * Returns null when the plan confers nothing (unknown product, inactive status,
 * or the free starter tier) — null means "revoke to the standard rate".
 */
export function grantedTierForSeatSubscription(
  productId: string | null | undefined,
  status: string | null | undefined,
): string | null {
  if (!productId || !status) return null;
  if (!SEAT_ACTIVE_STATUSES.has(status)) return null;
  const seatTier = SEAT_PRODUCT_TO_TIER[productId];
  if (!seatTier) return null;
  return SEAT_TIER_TO_SUBSCRIPTION[seatTier] ?? null;
}
