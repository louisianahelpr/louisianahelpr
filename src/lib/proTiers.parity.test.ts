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

const PAID_TIERS: ProTierKey[] = ["pro", "elite"];
const CYCLES: ProBillingCycle[] = ["monthly", "annual", "one_time"];

describe("consumer subscription checkout price config (F-MONEY-01 drift guard)", () => {
  it("client mirror equals the edge source (single source of truth)", () => {
    expect(PRO_PRICE_MAP).toEqual(EDGE_PRO_PRICE_MAP);
    expect(PRO_RECURRING_AMOUNT_CENTS).toEqual(EDGE_PRO_RECURRING_AMOUNT_CENTS);
  });

  it("maps exactly the two paid tiers for every billing cycle", () => {
    for (const cycle of CYCLES) {
      expect(Object.keys(PRO_PRICE_MAP[cycle]).sort()).toEqual(["elite", "pro"]);
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

  it("locks the exact live Stripe Price IDs the checkout points at", () => {
    // Changing a live price requires creating a new immutable Stripe Price and
    // updating BOTH this expectation and the ledger above — a deliberate act,
    // never an accidental drift.
    expect(PRO_PRICE_MAP).toEqual({
      monthly: {
        pro: "price_1TAZkLKp2H4b7tEC0ACbAX2y",
        elite: "price_1TAZkSKp2H4b7tEClf0VNiEa",
      },
      annual: {
        pro: "price_1TAZkbKp2H4b7tECZ7Qr6CZS",
        elite: "price_1TAZkcKp2H4b7tECagD42xRa",
      },
      one_time: {
        pro: "price_1TAZkeKp2H4b7tECnfZ7vF0C",
        elite: "price_1TAZkeKp2H4b7tECmn27C8JM",
      },
    });
  });
});
