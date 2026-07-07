// subscriptionTiers is the single source of truth for tier fees and pricing.
// The whole app's fee math (in-feed payout preview, checkout summary, Legal
// page fee disclosure) derives from TIER_PERKS, so a silent drift here would
// misquote what a Helpr actually keeps. These tests pin the fee model's
// invariants and the two pieces of real branch logic (getPaysSelfBack,
// toSubscriptionTier).

import { describe, it, expect } from "vitest";
import {
  TIER_PERKS,
  getPaysSelfBack,
  toSubscriptionTier,
  type SubscriptionTier,
} from "./subscriptionTiers";

const PAID_TIERS: SubscriptionTier[] = ["pro", "elite", "business"];
const ALL_TIERS: SubscriptionTier[] = ["free", ...PAID_TIERS];

describe("TIER_PERKS fee model", () => {
  it("uses the documented platform fee per tier (12 / 10 / 8 / 6)", () => {
    expect(TIER_PERKS.free.platformFeePercent).toBe(12);
    expect(TIER_PERKS.pro.platformFeePercent).toBe(10);
    expect(TIER_PERKS.elite.platformFeePercent).toBe(8);
    expect(TIER_PERKS.business.platformFeePercent).toBe(6);
  });

  it("keeps every fee a sane percentage (0 < fee < 100)", () => {
    for (const tier of ALL_TIERS) {
      const fee = TIER_PERKS[tier].platformFeePercent;
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThan(100);
    }
  });

  it("descends strictly as the tier rises (higher tier never pays more)", () => {
    expect(TIER_PERKS.free.platformFeePercent).toBeGreaterThan(
      TIER_PERKS.pro.platformFeePercent,
    );
    expect(TIER_PERKS.pro.platformFeePercent).toBeGreaterThan(
      TIER_PERKS.elite.platformFeePercent,
    );
    expect(TIER_PERKS.elite.platformFeePercent).toBeGreaterThan(
      TIER_PERKS.business.platformFeePercent,
    );
  });

  it("implies Helprs keep 88–94% of the agreed price", () => {
    // keep% = 100 − fee%. This is the number the Legal page and in-feed
    // preview promise, so guard it directly.
    expect(100 - TIER_PERKS.free.platformFeePercent).toBe(88);
    expect(100 - TIER_PERKS.pro.platformFeePercent).toBe(90);
    expect(100 - TIER_PERKS.elite.platformFeePercent).toBe(92);
    expect(100 - TIER_PERKS.business.platformFeePercent).toBe(94);
  });

  it("only the free tier is priceless; paid tiers cost more as they rise", () => {
    expect(TIER_PERKS.free.price).toBeNull();
    expect(TIER_PERKS.free.annualPrice).toBeNull();
    for (const tier of PAID_TIERS) {
      expect(TIER_PERKS[tier].price).not.toBeNull();
      // Annual is billed at a discount (2 months free), so it must be lower
      // than the monthly rate for every paid tier.
      expect(TIER_PERKS[tier].annualPrice!).toBeLessThan(TIER_PERKS[tier].price!);
    }
    expect(TIER_PERKS.pro.price!).toBeLessThan(TIER_PERKS.elite.price!);
    expect(TIER_PERKS.elite.price!).toBeLessThan(TIER_PERKS.business.price!);
  });

  it("carries the current tier display names (rebrand guard)", () => {
    expect(TIER_PERKS.free.name).toBe("Free");
    expect(TIER_PERKS.pro.name).toBe("Helpr Pro");
    expect(TIER_PERKS.elite.name).toBe("Helpr Elite");
    expect(TIER_PERKS.business.name).toBe("Business");
  });
});

describe("getPaysSelfBack", () => {
  it("returns an empty string for the free tier (no price to recoup)", () => {
    expect(getPaysSelfBack("free", 100, 10)).toBe("");
  });

  it("returns an empty string when no fees are saved (avg job value 0)", () => {
    // feesSavedPerJob = (0.12 − tierRate) * 0 = 0 → guard returns "".
    expect(getPaysSelfBack("pro", 0, 10)).toBe("");
  });

  it("says it pays for itself once monthly savings cover the price", () => {
    // pro: saved/job = (0.12 − 0.10) * 200 = $4; over 10 jobs = $40 ≥ $10.
    // jobsNeeded = ceil(10 / 4) = 3.
    expect(getPaysSelfBack("pro", 200, 10)).toBe(
      "Pays for itself after just 3 jobs/month",
    );
  });

  it("uses the singular 'job' when a single job covers the price", () => {
    // pro: saved/job = (0.12 − 0.10) * 600 = $12 ≥ $10 → jobsNeeded = 1.
    expect(getPaysSelfBack("pro", 600, 1)).toBe(
      "Pays for itself after just 1 job/month",
    );
  });

  it("falls back to a monthly-savings message when it doesn't fully pay off", () => {
    // pro: saved/job = $2; over 3 jobs = $6 < $10 → "Save $6/month...".
    expect(getPaysSelfBack("pro", 100, 3)).toBe(
      "Save $6/month on fees at 3 jobs",
    );
  });

  it("applies the larger business-tier discount (6% vs 12%)", () => {
    // business: saved/job = (0.12 − 0.06) * 200 = $12; over 5 jobs = $60 ≥ $50.
    // jobsNeeded = ceil(50 / 12) = 5.
    expect(getPaysSelfBack("business", 200, 5)).toBe(
      "Pays for itself after just 5 jobs/month",
    );
  });
});

describe("toSubscriptionTier", () => {
  it("passes through the canonical paid tier ids", () => {
    expect(toSubscriptionTier("pro")).toBe("pro");
    expect(toSubscriptionTier("elite")).toBe("elite");
    expect(toSubscriptionTier("business")).toBe("business");
  });

  it("maps null / undefined / empty to free (the default case)", () => {
    expect(toSubscriptionTier(null)).toBe("free");
    expect(toSubscriptionTier(undefined)).toBe("free");
    expect(toSubscriptionTier("")).toBe("free");
    expect(toSubscriptionTier("free")).toBe("free");
  });

  it("maps unknown / legacy values to free", () => {
    // "basic" is the retired tier — no paid subscribers, degrades to free.
    expect(toSubscriptionTier("basic")).toBe("free");
    expect(toSubscriptionTier("enterprise")).toBe("free");
    expect(toSubscriptionTier("premium")).toBe("free");
  });

  it("is case-sensitive — only lowercase ids match", () => {
    expect(toSubscriptionTier("PRO")).toBe("free");
    expect(toSubscriptionTier("Business")).toBe("free");
  });
});
