// Single source of truth for the CONSUMER subscription checkout — the
// billing_cycle × tier → Stripe Price ID that `create-pro-checkout` charges
// against. Extracted out of the edge function so the price a user is actually
// charged lives in ONE place and can be tied back to the displayed tier prices
// in src/lib/subscriptionTiers.ts. Drift between what the UI shows and what
// Stripe charges is caught by src/lib/proTiers.parity.test.ts.
//
// Mirrors the businessSeatTiers.ts pattern: plain TS (no Deno imports at module
// scope) so vitest can import it directly, with a thin client re-export at
// src/lib/proTiers.ts.
//
// STRIPE MODE ENV OVERRIDE: the hardcoded IDs below are the LIVE Price
// objects. When the edge function runs against test-mode Stripe (test
// STRIPE_SECRET_KEY), those live IDs don't exist and create-pro-checkout
// fails with an internal error. To support test-mode QA without duplicating
// the file, each ID can be overridden by a matching `STRIPE_PRICE_*` env
// var. `resolvePrice()` reads the env at call time — undefined env → fall
// back to the hardcoded live ID — so client-side (vitest, browser) code
// that has no `Deno.env` still gets the live IDs at import time, and edge
// runtime that provides the env sees the test IDs. Set the six vars via
// `supabase secrets set` when swapping keys.

export type ProTierKey = "basic" | "pro" | "elite";
export type ProBillingCycle = "monthly" | "annual" | "one_time";

// Read a Deno.env var safely — returns undefined outside a Deno runtime
// (browser, node/vitest) so importing this file doesn't crash there.
const readEnv = (key: string): string | undefined => {
  const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
  return d?.env?.get?.(key);
};

const LIVE_PRO_PRICE_MAP: Record<ProBillingCycle, Record<ProTierKey, string>> = {
  monthly: {
    // Basic live IDs are placeholders until the Live Basic Stripe Prices
    // are created. Test-mode uses the env-var overrides below and works
    // today; a future live-mode rollout MUST create matching live Prices
    // and paste those IDs here.
    basic: "price_TODO_LIVE_BASIC_MONTHLY",
    pro: "price_1TAZkLKp2H4b7tEC0ACbAX2y",
    elite: "price_1TAZkSKp2H4b7tEClf0VNiEa",
  },
  annual: {
    basic: "price_TODO_LIVE_BASIC_ANNUAL",
    pro: "price_1TAZkbKp2H4b7tECZ7Qr6CZS",
    elite: "price_1TAZkcKp2H4b7tECagD42xRa",
  },
  one_time: {
    basic: "price_TODO_LIVE_BASIC_ONETIME",
    pro: "price_1TAZkeKp2H4b7tECnfZ7vF0C",
    elite: "price_1TAZkeKp2H4b7tECmn27C8JM",
  },
};

const ENV_KEY: Record<ProBillingCycle, Record<ProTierKey, string>> = {
  monthly: {
    basic: "STRIPE_PRICE_BASIC_MONTHLY",
    pro: "STRIPE_PRICE_PRO_MONTHLY",
    elite: "STRIPE_PRICE_ELITE_MONTHLY",
  },
  annual: {
    basic: "STRIPE_PRICE_BASIC_ANNUAL",
    pro: "STRIPE_PRICE_PRO_ANNUAL",
    elite: "STRIPE_PRICE_ELITE_ANNUAL",
  },
  one_time: {
    basic: "STRIPE_PRICE_BASIC_ONETIME",
    pro: "STRIPE_PRICE_PRO_ONETIME",
    elite: "STRIPE_PRICE_ELITE_ONETIME",
  },
};

/**
 * billing_cycle → tier → Stripe Price ID. Reads any env-provided override
 * lazily so a callsite reading PRO_PRICE_MAP.monthly.pro at edge-function
 * invocation time picks up the test env, while vitest importing the same
 * shape at build time sees the hardcoded live IDs (env undefined). Values
 * are exposed as getters so each read hits the env fresh — no module-load
 * snapshot to invalidate when secrets rotate.
 */
export const PRO_PRICE_MAP: Record<ProBillingCycle, Record<ProTierKey, string>> = {
  monthly: {
    get basic() { return readEnv(ENV_KEY.monthly.basic) ?? LIVE_PRO_PRICE_MAP.monthly.basic; },
    get pro() { return readEnv(ENV_KEY.monthly.pro) ?? LIVE_PRO_PRICE_MAP.monthly.pro; },
    get elite() { return readEnv(ENV_KEY.monthly.elite) ?? LIVE_PRO_PRICE_MAP.monthly.elite; },
  } as Record<ProTierKey, string>,
  annual: {
    get basic() { return readEnv(ENV_KEY.annual.basic) ?? LIVE_PRO_PRICE_MAP.annual.basic; },
    get pro() { return readEnv(ENV_KEY.annual.pro) ?? LIVE_PRO_PRICE_MAP.annual.pro; },
    get elite() { return readEnv(ENV_KEY.annual.elite) ?? LIVE_PRO_PRICE_MAP.annual.elite; },
  } as Record<ProTierKey, string>,
  one_time: {
    get basic() { return readEnv(ENV_KEY.one_time.basic) ?? LIVE_PRO_PRICE_MAP.one_time.basic; },
    get pro() { return readEnv(ENV_KEY.one_time.pro) ?? LIVE_PRO_PRICE_MAP.one_time.pro; },
    get elite() { return readEnv(ENV_KEY.one_time.elite) ?? LIVE_PRO_PRICE_MAP.one_time.elite; },
  } as Record<ProTierKey, string>,
};

/**
 * The canonical whole-cent amount each RECURRING Stripe Price must charge —
 * the ledger the drift-guard test asserts against. Derived from the displayed
 * tier prices in src/lib/subscriptionTiers.ts:
 *   monthly = TIER_PERKS[tier].price × 100        (pro $10 / elite $15)
 *   annual  = monthly × 10 (a full year at "2 months free")
 *                                                 (pro $100 / elite $150)
 * Bumping a price in subscriptionTiers.ts without re-pointing the Stripe Price
 * here makes this ledger disagree with TIER_PERKS and fails the gate.
 *
 * one_time is intentionally excluded: subscriptionTiers.ts defines no one-time
 * amount, so there is no source of truth to tie it to — encoding a number here
 * would itself be an un-guarded guess.
 */
export const PRO_RECURRING_AMOUNT_CENTS: Record<"monthly" | "annual", Record<ProTierKey, number>> = {
  monthly: { basic: 500, pro: 1000, elite: 1500 },
  annual: { basic: 5000, pro: 10000, elite: 15000 },
};
