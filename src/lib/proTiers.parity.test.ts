import { describe, it, expect } from "vitest";
import { TIER_PERKS, type SubscriptionTier } from "./subscriptionTiers";
import {
  PRO_PRICE_MAP,
  PRO_RECURRING_AMOUNT_CENTS,
  type ProTierKey,
  type ProBillingCycle,
} from "./proTiers";
// The edge source lives in the Deno functions tree. It is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This test is the
// F-MONEY-01 drift guard: it ties the consumer-subscription checkout price map
// back to the displayed tier prices in subscriptionTiers.ts, so a price shown
// in the UI can never silently diverge from what Stripe actually charges.
import {
  PRO_PRICE_MAP as EDGE_PRO_PRICE_MAP,
  PRO_RECURRING_AMOUNT_CENTS as EDGE_PRO_RECURRING_AMOUNT_CENTS,
} from "../../supabase/functions/_shared/proTiers";

const PAID_TIERS: ProTierKey[] = ["basic", "pro", "elite"];
const CYCLES: ProBillingCycle[] = ["monthly", "annual", "one_time"];

describe("consumer subscription checkout price config (F-MONEY-01 drift guard)", () => {
  it("client mirror equals the edge source (single source of truth)", () => {
    expect(PRO_PRICE_MAP).toEqual(EDGE_PRO_PRICE_MAP);
    expect(PRO_RECURRING_AMOUNT_CENTS).toEqual(EDGE_PRO_RECURRING_AMOUNT_CENTS);
  });

  it("maps exactly the four paid consumer tiers for every billing cycle", () => {
    for (const cycle of CYCLES) {
      expect(Object.keys(PRO_PRICE_MAP[cycle]).sort()).toEqual(["basic", "elite", "pro"]);
    }
  });

  it("every configured tier is a real paid tier in subscriptionTiers.ts", () => {
    for (const tier of PAID_TIERS) {
      const perks = TIER_PERKS[tier as SubscriptionTier];
      expect(perks).toBeDefined();
      // A purchasable tier must carry a positive monthly price in the source.
      expect(perks.price).toBeGreaterThan(0);
    }
  });

  it("monthly Stripe amount ledger matches the displayed monthly tier price", () => {
    for (const tier of PAID_TIERS) {
      const displayedCents = Math.round(TIER_PERKS[tier as SubscriptionTier].price! * 100);
      expect(PRO_RECURRING_AMOUNT_CENTS.monthly[tier]).toBe(displayedCents);
    }
  });

  it("annual Stripe amount ledger is a full year at 2-months-free (monthly × 10)", () => {
    for (const tier of PAID_TIERS) {
      expect(PRO_RECURRING_AMOUNT_CENTS.annual[tier]).toBe(
        PRO_RECURRING_AMOUNT_CENTS.monthly[tier] * 10,
      );
    }
  });

  it("displayed annual monthly-equivalent (annualPrice) derives from the annual ledger", () => {
    // annualPrice is stored rounded-to-cents (yearly ÷ 12) for the "$X/mo annual"
    // label, so reconstruct it FROM the ledger the same way and confirm they agree.
    for (const tier of PAID_TIERS) {
      const monthlyEquiv =
        Math.round(PRO_RECURRING_AMOUNT_CENTS.annual[tier] / 12) / 100;
      expect(monthlyEquiv).toBe(TIER_PERKS[tier as SubscriptionTier].annualPrice);
    }
  });

  it("locks the exact live Stripe Price IDs the checkout points at (Pro + Elite)", () => {
    // Changing a live price requires creating a new immutable Stripe Price and
    // updating BOTH this expectation and the ledger above — a deliberate act,
    // never an accidental drift. Pro/Elite are asserted for real live Price IDs
    // that were already created; Basic uses the env-var override in test mode
    // and its LIVE fallback is a TODO placeholder until Basic ships to live —
    // covered by the next test.
    expect(PRO_PRICE_MAP.monthly.pro).toBe("price_1TAZkLKp2H4b7tEC0ACbAX2y");
    expect(PRO_PRICE_MAP.monthly.elite).toBe("price_1UCRNVKp2H4b7tECg66qPod9");
    expect(PRO_PRICE_MAP.annual.pro).toBe("price_1TAZkbKp2H4b7tECZ7Qr6CZS");
    expect(PRO_PRICE_MAP.annual.elite).toBe("price_1UCRNsKp2H4b7tECkZLTQjRB");
    expect(PRO_PRICE_MAP.one_time.pro).toBe("price_1TAZkeKp2H4b7tECnfZ7vF0C");
    expect(PRO_PRICE_MAP.one_time.elite).toBe("price_1UCRNzKp2H4b7tEC3MUHI7Lu");
  });

  it("sells no tier that lacks a live Stripe Price", () => {
    // The Plus tier (removed 2026-08-28) shipped with three
    // `price_TODO_LIVE_PLUS_*` placeholders while both storefronts sold it —
    // every purchase would have 500'd the moment the live key went in, which
    // is exactly what Basic once did. Nothing in the map may carry a
    // placeholder id again, for any tier.
    for (const cycle of CYCLES) {
      for (const tier of PAID_TIERS) {
        expect(PRO_PRICE_MAP[cycle][tier], `${cycle} ${tier} price id`)
          .not.toMatch(/TODO|PLACEHOLDER/i);
      }
    }
  });

  it("Basic Price IDs are either env-overridden (test) or the TODO placeholder (live)", () => {
    // This assertion used to be `startsWith("price_TODO_LIVE_BASIC_") ||
    // startsWith("price_")`, which cannot fail: the placeholder ALSO starts
    // with "price_". So the one test meant to make the placeholder visible
    // passed happily while a live Upgrade tap 500'd against Stripe.
    //
    // A real Stripe Price id is "price_" followed by a base-62 object id —
    // never an upper-case TODO token — so match that shape instead.
    for (const cycle of CYCLES) {
      const id = PRO_PRICE_MAP[cycle].basic;
      expect(id, `${cycle} basic price id`).toMatch(/^price_[A-Za-z0-9]{16,}$/);
      expect(id, `${cycle} basic must not be a placeholder`).not.toContain("TODO");
    }
  });
});

describe("ME-039 (lh-money-escrow 2026-09-04): STRIPE_PRICE_* overrides are gated on STRIPE_SECRET_KEY's own mode", () => {
  // resolvePrice() used to apply an env override unconditionally whenever the
  // six STRIPE_PRICE_* vars were set, with nothing coupling their removal to
  // flipping STRIPE_SECRET_KEY back to live — a go-live that swapped the key
  // but left the overrides set would silently post TEST price ids to a LIVE
  // key. Simulates the Deno runtime by stubbing `globalThis.Deno.env.get`,
  // since resolvePrice() reads it fresh on every property access rather than
  // snapshotting at import time (see `readEnv` in the edge source).
  const ORIGINAL_DENO = (globalThis as { Deno?: unknown }).Deno;

  const withDenoEnv = (vars: Record<string, string>, run: () => void) => {
    (globalThis as { Deno?: unknown }).Deno = {
      env: { get: (k: string) => vars[k] },
    };
    try {
      run();
    } finally {
      (globalThis as { Deno?: unknown }).Deno = ORIGINAL_DENO;
    }
  };

  it("ignores the override when STRIPE_SECRET_KEY is a live key", () => {
    withDenoEnv(
      { STRIPE_SECRET_KEY: "sk_live_abc123", STRIPE_PRICE_PRO_MONTHLY: "price_TEST_OVERRIDE" },
      () => {
        expect(EDGE_PRO_PRICE_MAP.monthly.pro).toBe("price_1TAZkLKp2H4b7tEC0ACbAX2y");
      },
    );
  });

  it("honors the override when STRIPE_SECRET_KEY is a test key", () => {
    withDenoEnv(
      { STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_PRICE_PRO_MONTHLY: "price_TEST_OVERRIDE" },
      () => {
        expect(EDGE_PRO_PRICE_MAP.monthly.pro).toBe("price_TEST_OVERRIDE");
      },
    );
  });

  it("falls back to the live id when no override is set, in either mode", () => {
    withDenoEnv({ STRIPE_SECRET_KEY: "sk_test_abc123" }, () => {
      expect(EDGE_PRO_PRICE_MAP.monthly.pro).toBe("price_1TAZkLKp2H4b7tEC0ACbAX2y");
    });
  });
});
