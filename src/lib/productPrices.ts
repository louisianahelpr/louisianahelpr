// Client mirror of the fixed one-time Stripe product prices defined on the edge
// in supabase/functions/_shared/productPrices.ts. Kept in sync by
// productPrices.parity.test.ts so a UI price can never silently diverge from the
// amount the edge function charges through Stripe Checkout.

import { formatPriceExact } from "@/lib/format";

export const BOOST_FEE_CENTS = 300; // $3.00 — 24h featured placement
export const BGC_FEE_CENTS = 3499; // $34.99 — one-time background screening

export const BOOST_DURATION_HOURS = 24;

// Format a whole-cent amount as a display price: "$3" when it's a round dollar,
// "$34.99" otherwise. Delegates to formatPriceExact for float-safe rounding.
export const formatFeeUsd = (cents: number): string => `$${formatPriceExact(cents / 100)}`;

// ─── Job Boost pricing by subscription tier ──────────────────────────────────
// The AUTHORITY is supabase/functions/create-boost-payment/index.ts — it is the
// only thing that names a price to Stripe. This mirror exists so the dialog can
// show the amount that will actually be charged instead of guessing.
//
// The server's rule, in full:
//   • active Elite            → free (the boost flags are flipped directly, no
//                               Checkout session at all)
//   • active Basic / Pro      → BOOST_DISCOUNT_PCT off BOOST_FEE_CENTS
//   • Free / Business / any   → BOOST_FEE_CENTS
//     lapsed subscription
//
// `BOOST_MIN_UNIT_AMOUNT_CENTS` is the server's defensive floor covering
// Stripe's per-charge cost; it only bites if BOOST_FEE_CENTS is ever cut below
// ~$1.25, and when it does the server also drops the "% off" wording from the
// receipt — so `discounted` goes false here in exactly the same case.

/** Percent off a boost for the discount tiers. Mirrors the edge constant. */
export const BOOST_DISCOUNT_PCT = 20;

/** Absolute floor on a boost charge, mirroring the edge fee-floor guard. */
export const BOOST_MIN_UNIT_AMOUNT_CENTS = 100;

/** Tiers that pay a discounted boost. Elite is free; everyone else pays full. */
const BOOST_DISCOUNT_TIERS = ["basic", "pro"] as const;

/** Tier whose boosts are included in the plan. */
const BOOST_FREE_TIER = "elite";

export type BoostPrice =
  | { free: true }
  | { free: false; cents: number; discounted: boolean };

/**
 * What this poster will be charged for a boost, resolved by the same rule the
 * edge function uses. `subscriptionActive` is the caller's expiry check — an
 * expired subscription pays full price, exactly as on the server.
 */
export function boostPriceForTier(
  tier: string | null | undefined,
  subscriptionActive: boolean,
): BoostPrice {
  const effective = subscriptionActive ? (tier ?? "free") : "free";
  if (effective === BOOST_FREE_TIER) return { free: true };
  if (!(BOOST_DISCOUNT_TIERS as readonly string[]).includes(effective)) {
    return { free: false, cents: BOOST_FEE_CENTS, discounted: false };
  }
  const raw = Math.round((BOOST_FEE_CENTS * (100 - BOOST_DISCOUNT_PCT)) / 100);
  const cents = Math.max(raw, BOOST_MIN_UNIT_AMOUNT_CENTS);
  return { free: false, cents, discounted: cents === raw };
}
