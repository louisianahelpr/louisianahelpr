// Single source of truth for the FOUR business seat-plan tiers — the seat
// count, display price, and (where a plan is paid) the Stripe Price ID a
// checkout charges against. Every surface that shows a seat tier or price
// derives from THIS array so the marketing page, the in-app seat plan, and
// the checkout edge function can never silently disagree again.
//
// The MARKETING page (src/pages/ForBusiness.tsx) is the canonical figure set
// per product decision: Starter Free/1 · Crew $20/2 · Team $30/3 (featured)
// · Enterprise $40/4+.
//
// This is the edge-side source of truth; the client mirror is
// src/lib/businessSeatTiers.ts (a thin re-export of this module), and the two
// runtimes are kept in lock-step by src/lib/businessSeatTiers.parity.test.ts.
//
// Plain TS (no Deno imports at module scope) so vitest can import it directly.
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠️  STRIPE PRICE OBJECTS STILL CHARGE THE OLD AMOUNTS. The stripePriceId
// values below are the pre-existing Stripe Price IDs, which are configured in
// the Stripe dashboard to charge the OLD amounts ($10 / $20 / $40 at 5 / 10 /
// 15 seats) — NOT the canonical amounts shown here. This config fixes only the
// DISPLAYED figures + the tier→price mapping. To make Stripe actually CHARGE
// the canonical amounts ($20 / $30 / $40 at 2 / 3 / 4+ seats), a human must
// update (or replace) the Stripe Price objects in the Stripe dashboard. Until
// then, the number a user sees will not match the amount Stripe bills.
// ─────────────────────────────────────────────────────────────────────────

export type BusinessSeatTierKey = "starter" | "crew" | "team" | "enterprise";

export interface BusinessSeatTier {
  key: BusinessSeatTierKey;
  name: string;
  /** Display seat count — a string because Enterprise shows "4+". */
  seats: string;
  /** Display price — "Free" for the no-cost tier, "$20" otherwise. */
  priceLabel: string;
  /** Whole-cent price (0 for Free) — the numeric source for any math/parity. */
  priceCents: number;
  featured: boolean;
  /**
   * Stripe Price ID for the paid tiers, or null for Free (no checkout). See the
   * caveat above: these IDs still charge the OLD amounts until a human updates
   * the Stripe Price objects in the dashboard.
   */
  stripePriceId: string | null;
}

export const BUSINESS_SEAT_TIERS: readonly BusinessSeatTier[] = [
  {
    key: "starter",
    name: "Starter",
    seats: "1",
    priceLabel: "Free",
    priceCents: 0,
    featured: false,
    stripePriceId: null, // Free — no Stripe checkout.
  },
  {
    key: "crew",
    name: "Crew",
    seats: "2",
    priceLabel: "$20",
    priceCents: 2000,
    featured: false,
    stripePriceId: "price_1TQKGYKp2H4b7tECTmOd0rp7", // ⚠️ still charges $10 at 5 seats — update in Stripe dashboard.
  },
  {
    key: "team",
    name: "Team",
    seats: "3",
    priceLabel: "$30",
    priceCents: 3000,
    featured: true,
    stripePriceId: "price_1TQKGZKp2H4b7tECwr664UEh", // ⚠️ still charges $20 at 10 seats — update in Stripe dashboard.
  },
  {
    key: "enterprise",
    name: "Enterprise",
    seats: "4+",
    priceLabel: "$40",
    priceCents: 4000,
    featured: false,
    stripePriceId: "price_1TQKGaKp2H4b7tECp6ZNxarR", // ⚠️ still charges $40 at 15 seats — update in Stripe dashboard.
  },
] as const;

/**
 * tier key → Stripe Price ID, for the PAID tiers only (Starter/Free is
 * omitted — it has no checkout). Built from the canonical array so the edge
 * checkout function can never drift from the displayed tiers.
 */
export const BUSINESS_SEAT_TIER_TO_PRICE: Record<string, string> = Object.fromEntries(
  BUSINESS_SEAT_TIERS.filter(
    (t): t is BusinessSeatTier & { stripePriceId: string } => t.stripePriceId !== null,
  ).map((t) => [t.key, t.stripePriceId]),
);
