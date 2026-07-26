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
// The stripePriceId values below are LIVE recurring Prices that charge the
// canonical amounts shown here ($20 Crew / $30 Team / $40 Enterprise, monthly).
// Stripe Price objects are immutable, so the Crew/Team prices were re-created
// (2026-07-05) at the correct amounts and the old under-charging IDs retired.

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
   * Stripe Price ID for the paid tiers, or null for Free (no checkout). These
   * are LIVE recurring Prices that charge the canonical amount shown above.
   */
  stripePriceId: string | null;
  /**
   * Whole-cent price of the ANNUAL plan, billed once per year. Follows the same
   * pay-10-months-get-12 convention the consumer tiers already use (Pro is
   * $10/mo or $100/yr — see `annualPrice` in src/lib/subscriptionTiers.ts), so
   * Crew $20/mo → $200/yr, Team $30/mo → $300/yr, Enterprise $40/mo → $400/yr.
   * 0 for Free.
   */
  annualPriceCents: number;
  /**
   * Stripe Price ID for the ANNUAL plan.
   *
   * NULL UNTIL THE PRICES EXIST. Stripe Prices can only be created in the
   * Stripe dashboard/API, not from here, so these stay null until a human makes
   * three yearly recurring Prices against the SAME products as the monthly IDs
   * above, at the `annualPriceCents` amounts. Either paste the IDs in here, or
   * set STRIPE_PRICE_SEAT_<TIER>_ANNUAL and leave these null — the getter below
   * prefers the env var. No other code change is needed either way.
   *
   * While null, requesting an annual checkout returns a clear error instead of
   * silently charging the monthly price — see create-business-seat-checkout.
   */
  stripePriceIdAnnual: string | null;
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
    annualPriceCents: 0,
    stripePriceIdAnnual: null,
  },
  {
    key: "crew",
    name: "Crew",
    seats: "2",
    priceLabel: "$20",
    priceCents: 2000,
    featured: false,
    stripePriceId: "price_1TpvLSKp2H4b7tECkJALCpxj", // LIVE $20/mo (created 2026-07-05; retired old $10 price_1TQKGY…).
    annualPriceCents: 20000, // $200/yr — $20 x 10, two months free.
    stripePriceIdAnnual: null, // TODO(owner): create a $200/yr Price, or set STRIPE_PRICE_SEAT_CREW_ANNUAL.
  },
  {
    key: "team",
    name: "Team",
    seats: "3",
    priceLabel: "$30",
    priceCents: 3000,
    featured: true,
    stripePriceId: "price_1TpvLdKp2H4b7tECODF3U9RJ", // LIVE $30/mo (created 2026-07-05; retired old $20 price_1TQKGZ…).
    annualPriceCents: 30000, // $300/yr — $30 x 10, two months free.
    stripePriceIdAnnual: null, // TODO(owner): create a $300/yr Price, or set STRIPE_PRICE_SEAT_TEAM_ANNUAL.
  },
  {
    key: "enterprise",
    name: "Enterprise",
    seats: "4+",
    priceLabel: "$40",
    priceCents: 4000,
    featured: false,
    stripePriceId: "price_1TQKGaKp2H4b7tECp6ZNxarR", // LIVE $40/mo — already at the canonical amount, unchanged.
    annualPriceCents: 40000, // $400/yr — $40 x 10, two months free.
    stripePriceIdAnnual: null, // TODO(owner): create a $400/yr Price, or set STRIPE_PRICE_SEAT_ENTERPRISE_ANNUAL.
  },
] as const;

// STRIPE MODE ENV OVERRIDE: the hardcoded IDs above are LIVE Prices. In test
// mode those IDs don't exist and create-business-seat-checkout fails. Each
// paid tier can be overridden by a `STRIPE_PRICE_SEAT_<TIER>` env var, read
// lazily at call time so vitest (no Deno.env) still gets the live IDs and
// edge runtime with the env set gets the test IDs. Mirrors proTiers.ts.
const readEnv = (key: string): string | undefined => {
  const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
  return d?.env?.get?.(key);
};

const SEAT_ENV_KEY: Record<string, string> = {
  crew: "STRIPE_PRICE_SEAT_CREW",
  team: "STRIPE_PRICE_SEAT_TEAM",
  enterprise: "STRIPE_PRICE_SEAT_ENTERPRISE",
};

const SEAT_ENV_KEY_ANNUAL: Record<string, string> = {
  crew: "STRIPE_PRICE_SEAT_CREW_ANNUAL",
  team: "STRIPE_PRICE_SEAT_TEAM_ANNUAL",
  enterprise: "STRIPE_PRICE_SEAT_ENTERPRISE_ANNUAL",
};

/**
 * tier key → Stripe Price ID, for the PAID tiers only (Starter/Free is
 * omitted — it has no checkout). Built from the canonical array so the edge
 * checkout function can never drift from the displayed tiers. Each value is a
 * getter that reads the matching STRIPE_PRICE_SEAT_* env var lazily and falls
 * back to the hardcoded LIVE ID if the env is unset.
 */
export const BUSINESS_SEAT_TIER_TO_PRICE: Record<string, string> = (() => {
  const paid = BUSINESS_SEAT_TIERS.filter(
    (t): t is BusinessSeatTier & { stripePriceId: string } => t.stripePriceId !== null,
  );
  const result = {} as Record<string, string>;
  for (const t of paid) {
    const envKey = SEAT_ENV_KEY[t.key];
    Object.defineProperty(result, t.key, {
      enumerable: true,
      get() { return (envKey ? readEnv(envKey) : undefined) ?? t.stripePriceId; },
    });
  }
  return result;
})();

/**
 * tier key → ANNUAL Stripe Price ID, for the paid tiers. Same lazy-getter shape
 * as the monthly map, but the value may legitimately be `undefined` today: the
 * annual Prices do not exist yet, so a tier resolves only once its
 * STRIPE_PRICE_SEAT_<TIER>_ANNUAL env var is set or its `stripePriceIdAnnual`
 * is filled in. Callers MUST treat undefined as "annual not available" and say
 * so, never fall back to the monthly Price — that would bill someone $20 for
 * what the UI offered as a $200 yearly plan.
 */
export const BUSINESS_SEAT_TIER_TO_PRICE_ANNUAL: Record<string, string | undefined> = (() => {
  const result = {} as Record<string, string | undefined>;
  for (const t of BUSINESS_SEAT_TIERS) {
    if (t.stripePriceId === null) continue; // Free tier has no checkout at all.
    const envKey = SEAT_ENV_KEY_ANNUAL[t.key];
    Object.defineProperty(result, t.key, {
      enumerable: true,
      get() { return (envKey ? readEnv(envKey) : undefined) ?? t.stripePriceIdAnnual ?? undefined; },
    });
  }
  return result;
})();

/** True when every paid tier has an annual Price resolvable — i.e. the
 *  monthly/annual toggle can safely be shown. */
export const ANNUAL_SEAT_PRICING_AVAILABLE = (): boolean =>
  BUSINESS_SEAT_TIERS.filter((t) => t.stripePriceId !== null)
    .every((t) => !!BUSINESS_SEAT_TIER_TO_PRICE_ANNUAL[t.key]);
