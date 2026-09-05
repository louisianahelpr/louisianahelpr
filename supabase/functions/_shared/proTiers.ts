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
// var — but the override is only HONORED when STRIPE_SECRET_KEY is itself a
// test key (`sk_test_...`). Set the six vars via `supabase secrets set` when
// testing.
//
// ME-039 (lh-money-escrow, 2026-09-04): the override used to apply
// unconditionally whenever the six STRIPE_PRICE_* vars were set, with
// nothing coupling their removal to flipping STRIPE_SECRET_KEY back to live.
// A go-live that swapped the key but forgot to unset the six overrides (or
// unset them in a separate step CI doesn't enforce) would silently post test
// Price IDs to a live Stripe key and 500 every membership checkout —
// launch-day-shaped, since nothing short of a live transaction attempt would
// catch it. Deriving the mode from the key's own prefix removes the
// human-coordinated step entirely: the ID always matches whatever mode the
// key running RIGHT NOW is actually in, so the two can no longer drift apart.

export type ProTierKey = "basic" | "pro" | "elite";
export type ProBillingCycle = "monthly" | "annual" | "one_time";

// Read a Deno.env var safely — returns undefined outside a Deno runtime
// (browser, node/vitest) so importing this file doesn't crash there.
const readEnv = (key: string): string | undefined => {
  const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
  return d?.env?.get?.(key);
};

// The override only ever applies in test mode — never in vitest/browser
// (no Deno.env → undefined → falls through to "not test mode" → live IDs,
// same as before) and never when STRIPE_SECRET_KEY is a live key, no matter
// what the six STRIPE_PRICE_* vars are set to.
const isStripeTestMode = (): boolean => (readEnv("STRIPE_SECRET_KEY") ?? "").startsWith("sk_test_");

const LIVE_PRO_PRICE_MAP: Record<ProBillingCycle, Record<ProTierKey, string>> = {
  monthly: {
    // Basic's live IDs sat as placeholder strings long after the Prices
    // themselves existed in Stripe. /subscription hides Basic
    // (SubscriptionPage.tsx) so it never surfaced there — but the in-app
    // Membership tab renders and sells it, so every Basic Upgrade tap posted a
    // placeholder string to live Stripe and returned an opaque 500.
    // Verified against live acct_1RQbAfKp2H4b7tEC: all three are active,
    // livemode, and match PRO_RECURRING_AMOUNT_CENTS (500 / 5000 / 500).
    //
    // ELITE REPOINTED 2026-09-05. The old ids
    // (price_1TAZkSKp…lf0VNiEa / …agD42xRa / …mn27C8JM) are still ACTIVE in
    // live Stripe and still charge the PRE-RAISE $15 / $150 / $15. The
    // 2026-08-27 raise to $20 / $200 / $20 reached this file and the TEST-mode
    // Prices; live never got it. Read straight off the live account today:
    // Basic and Pro matched to the cent, Elite was 25% under on all three
    // cycles — so the moment STRIPE_SECRET_KEY goes live the storefront sells
    // Elite at $20 and Stripe collects $15.
    //
    // Nothing could have caught it. PRO_RECURRING_AMOUNT_CENTS is only ever
    // compared against our own displayed prices (proTiers.parity.test.ts), so
    // the guard is a closed loop between two files we control and cannot see
    // Stripe at all. Zero live subscriptions existed, so nobody was
    // grandfathered and no refund is owed.
    //
    // Stripe Prices are IMMUTABLE in unit_amount, so the fix is new Price
    // objects, not an edit. The old ones are deliberately left active until
    // this deploys — archiving them first would break live checkout in the
    // window between.
    basic: "price_1TAZjdKp2H4b7tECG4TDPOxd",
    pro: "price_1TAZkLKp2H4b7tEC0ACbAX2y",
    elite: "price_1UCRNVKp2H4b7tECg66qPod9",
  },
  annual: {
    basic: "price_1TAZkXKp2H4b7tECRBtNRne5",
    pro: "price_1TAZkbKp2H4b7tECZ7Qr6CZS",
    elite: "price_1UCRNsKp2H4b7tECkZLTQjRB",
  },
  one_time: {
    basic: "price_1TAZkdKp2H4b7tECtvvFRyJf",
    pro: "price_1TAZkeKp2H4b7tECnfZ7vF0C",
    elite: "price_1UCRNzKp2H4b7tEC3MUHI7Lu",
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
const resolvePrice = (cycle: ProBillingCycle, tier: ProTierKey): string => {
  if (isStripeTestMode()) {
    const override = readEnv(ENV_KEY[cycle][tier]);
    if (override) return override;
  }
  return LIVE_PRO_PRICE_MAP[cycle][tier];
};

export const PRO_PRICE_MAP: Record<ProBillingCycle, Record<ProTierKey, string>> = {
  monthly: {
    get basic() { return resolvePrice("monthly", "basic"); },
    get pro() { return resolvePrice("monthly", "pro"); },
    get elite() { return resolvePrice("monthly", "elite"); },
  } as Record<ProTierKey, string>,
  annual: {
    get basic() { return resolvePrice("annual", "basic"); },
    get pro() { return resolvePrice("annual", "pro"); },
    get elite() { return resolvePrice("annual", "elite"); },
  } as Record<ProTierKey, string>,
  one_time: {
    get basic() { return resolvePrice("one_time", "basic"); },
    get pro() { return resolvePrice("one_time", "pro"); },
    get elite() { return resolvePrice("one_time", "elite"); },
  } as Record<ProTierKey, string>,
};

/**
 * The canonical whole-cent amount each RECURRING Stripe Price must charge —
 * the ledger the drift-guard test asserts against. Derived from the displayed
 * tier prices in src/lib/subscriptionTiers.ts:
 *   monthly = TIER_PERKS[tier].price × 100   (basic $5 / pro $10 / elite $20)
 *   annual  = monthly × 10 (a full year at "2 months free")
 *                                                 (pro $100 / elite $200)
 * Bumping a price in subscriptionTiers.ts without re-pointing the Stripe Price
 * here makes this ledger disagree with TIER_PERKS and fails the gate.
 *
 * one_time is intentionally excluded: subscriptionTiers.ts defines no one-time
 * amount, so there is no source of truth to tie it to — encoding a number here
 * would itself be an un-guarded guess.
 */
export const PRO_RECURRING_AMOUNT_CENTS: Record<"monthly" | "annual", Record<ProTierKey, number>> = {
  monthly: { basic: 500, pro: 1000, elite: 2000 },
  annual: { basic: 5000, pro: 10000, elite: 20000 },
};
