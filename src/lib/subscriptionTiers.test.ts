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

// Every paid tier is a consumer subscription, and every tier there is. The
// table used to carry a fifth `business` row at 6% with a null price, excluded
// from these invariants because it was billed per-seat on a
// `_shared/businessSeatTiers.ts` ladder — a file that does not exist. It was
// removed on 2026-09-01: nothing could sell that tier, nothing could store it,
// and the prod census was zero rows. So PAID and ALL now differ only by "free".
const PAID_CONSUMER_TIERS: SubscriptionTier[] = ["basic", "pro", "elite"];
const ALL_TIERS: SubscriptionTier[] = ["free", "basic", "pro", "elite"];

describe("TIER_PERKS fee model", () => {
  it("uses the documented platform fee per tier (12 / 11 / 10 / 8)", () => {
    expect(TIER_PERKS.free.platformFeePercent).toBe(12);
    expect(TIER_PERKS.basic.platformFeePercent).toBe(11);
    expect(TIER_PERKS.pro.platformFeePercent).toBe(10);
    expect(TIER_PERKS.elite.platformFeePercent).toBe(8);
  });

  it("has exactly four tiers — the retired Business row is gone", () => {
    // Pins the KEY SET, not just the values. The `business` row had to leave
    // this table and `TIER_FEE_PERCENT` in one commit (the parity tests tie the
    // two key sets together), so a re-added row here must be a deliberate edit
    // that also updates the edge ladder.
    expect(Object.keys(TIER_PERKS).sort()).toEqual(["basic", "elite", "free", "plus", "pro"]);
    expect((TIER_PERKS as Record<string, unknown>).business).toBeUndefined();
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
      TIER_PERKS.basic.platformFeePercent,
    );
    expect(TIER_PERKS.basic.platformFeePercent).toBeGreaterThan(
      TIER_PERKS.pro.platformFeePercent,
    );
    expect(TIER_PERKS.pro.platformFeePercent).toBeGreaterThan(
      TIER_PERKS.elite.platformFeePercent,
    );
  });

  it("bottoms out at Elite's 8% — nothing on the ladder is cheaper", () => {
    // The retired Business row was the only rung below Elite (6%). Guard the
    // floor directly so a future cheaper tier is a deliberate, reviewed edit.
    const lowest = Math.min(...ALL_TIERS.map((t) => TIER_PERKS[t].platformFeePercent));
    expect(lowest).toBe(TIER_PERKS.elite.platformFeePercent);
    expect(lowest).toBe(8);
  });

  it("implies Helprs keep 88–92% of the agreed price", () => {
    // keep% = 100 − fee%. This is the number the Legal page and in-feed
    // preview promise, so guard it directly.
    expect(100 - TIER_PERKS.free.platformFeePercent).toBe(88);
    expect(100 - TIER_PERKS.basic.platformFeePercent).toBe(89);
    expect(100 - TIER_PERKS.pro.platformFeePercent).toBe(90);
    expect(100 - TIER_PERKS.elite.platformFeePercent).toBe(92);
  });

  it("Free is priceless; every PAID CONSUMER tier costs more as it rises", () => {
    expect(TIER_PERKS.free.price).toBeNull();
    expect(TIER_PERKS.free.annualPrice).toBeNull();
    for (const tier of PAID_CONSUMER_TIERS) {
      expect(TIER_PERKS[tier].price).not.toBeNull();
      // Annual is billed at a discount (2 months free), so it must be lower
      // than the monthly rate for every paid tier.
      expect(TIER_PERKS[tier].annualPrice!).toBeLessThan(TIER_PERKS[tier].price!);
    }
    expect(TIER_PERKS.basic.price!).toBeLessThan(TIER_PERKS.pro.price!);
    expect(TIER_PERKS.pro.price!).toBeLessThan(TIER_PERKS.elite.price!);
  });

  it("Free is the ONLY priceless tier", () => {
    // The retired Business row was the second null-priced entry, and its null
    // was the reason "every paid tier has a price" had to carve out an
    // exception. With it gone the invariant is total: price:null ⇔ free.
    for (const tier of ALL_TIERS) {
      const priceless = TIER_PERKS[tier].price === null;
      expect(priceless, `${tier} disagrees with the price:null ⇔ free rule`).toBe(tier === "free");
    }
  });

  it("carries the current tier display names (rebrand guard)", () => {
    // Owner's 2026-08-24 naming rule: the brand leads the tier name
    // everywhere a human reads it — bare "Basic / Pro / Elite" as of
    // 2026-08-27 (the "Helpr " prefix was reversed by the owner).
    // Free stays unprefixed too (see tierNames.parity.test.ts).
    expect(TIER_PERKS.free.name).toBe("Free");
    expect(TIER_PERKS.basic.name).toBe("Basic");
    expect(TIER_PERKS.pro.name).toBe("Pro");
    expect(TIER_PERKS.elite.name).toBe("Elite");
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

  it("returns empty for a stale 'business' row, via the normalizer", () => {
    // `business` was removed on 2026-09-01, so TIER_PERKS has no row for it and
    // the type can no longer express it. Every caller reaches this function
    // through `toSubscriptionTier`, which maps the stale string to "free" — and
    // free short-circuits at `!perks.price`. Pinning the composed path is the
    // useful assertion: it proves a legacy column value still renders a
    // membership card instead of throwing on a missing perks row.
    expect(getPaysSelfBack(toSubscriptionTier("business"), 200, 5)).toBe("");
    expect(getPaysSelfBack(toSubscriptionTier("business"), 1000, 20)).toBe("");
  });
});

describe("toSubscriptionTier", () => {
  it("passes through the canonical paid tier ids", () => {
    expect(toSubscriptionTier("pro")).toBe("pro");
    expect(toSubscriptionTier("elite")).toBe("elite");
  });

  it("maps the retired 'business' id to free, never through to a 6% rung", () => {
    // Removed 2026-09-01. A stale row holding it must be treated as an unknown
    // value and land on the safe default, which is also the never-under-charge
    // direction for `tierFeePercent` (12%).
    expect(toSubscriptionTier("business")).toBe("free");
  });

  it("maps null / undefined / empty to free (the default case)", () => {
    expect(toSubscriptionTier(null)).toBe("free");
    expect(toSubscriptionTier(undefined)).toBe("free");
    expect(toSubscriptionTier("")).toBe("free");
    expect(toSubscriptionTier("free")).toBe("free");
  });

  it("recognizes basic (entry paid consumer tier)", () => {
    expect(toSubscriptionTier("basic")).toBe("basic");
  });

  it("maps unknown / legacy values to free (safe default)", () => {
    expect(toSubscriptionTier("enterprise")).toBe("free");
    expect(toSubscriptionTier("premium")).toBe("free");
    expect(toSubscriptionTier("starter")).toBe("free");
  });

  it("is case-sensitive — only lowercase ids match", () => {
    expect(toSubscriptionTier("PRO")).toBe("free");
    expect(toSubscriptionTier("Business")).toBe("free");
  });
});
