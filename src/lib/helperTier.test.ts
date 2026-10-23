import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import {
  computeHelperTier,
  describeTierProgress,
  TIER_THRESHOLDS,
  type HelperTierProfile,
  type HelperTierStats,
} from "./helperTier";

// These cases test the ID check while it is ON. The owner switched it off on
// 2026-10-23 (switch `identity_check`); src/test/identityCheckOffEntryPoints.test.ts
// covers the off state.
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckOn: () => true, useIdentityCheckStatus: () => ({ on: true, settled: true }) }));
beforeEach(() => setIdentityCheckOn(true));
afterEach(() => setIdentityCheckOn(false));

// Boundary tests for the four-step verification ladder (#112). Each tier
// has multiple necessary conditions, so we test every "just below" and
// "exactly at" edge — those are the only places the function can quietly
// regress without a UI test catching it.

const verifiedProfile: HelperTierProfile = {
  idv_status: "verified",
  stripe_account_id: "acct_TEST123",
};

const zeroStats: HelperTierStats = {
  completedJobs: 0,
  avgRating: 0,
  reviewCount: 0,
};

describe("computeHelperTier — Tier 0 (no badge)", () => {
  it("returns 0 when profile is null", () => {
    expect(computeHelperTier(null, zeroStats)).toBe(0);
  });

  it("returns 0 unless Stripe IDENTITY verified the ID (owner 2026-10-21: the badge is Identity only)", () => {
    // The rung is a public "Verified" badge. Payout setup (Stripe Connect's
    // stripe_identity_verified) is a separate fact and must not earn it.
    for (const idv_status of ["not_started", "pending", "processing", "manual_review", "failed", null, undefined]) {
      expect(computeHelperTier({ ...verifiedProfile, idv_status }, zeroStats)).toBe(0);
    }
    const connectOnly = { stripe_account_id: "acct_123", stripe_identity_verified: true, idv_status: "not_started" };
    expect(computeHelperTier(connectOnly, zeroStats)).toBe(0);
  });

  it("accepts idv_status 'verified' (Stripe Identity, or an admin-approved ID, Q2201)", () => {
    expect(computeHelperTier({ stripe_account_id: "acct_123", idv_status: "verified" }, zeroStats)).toBe(1);
  });

  it("returns 0 when stripe_account_id is missing", () => {
    expect(
      computeHelperTier({ ...verifiedProfile, stripe_account_id: null }, zeroStats),
    ).toBe(0);
    expect(
      computeHelperTier({ ...verifiedProfile, stripe_account_id: "" }, zeroStats),
    ).toBe(0);
  });
});

describe("computeHelperTier — Tier 1 (Verified)", () => {
  it("returns 1 when all three onboarding signals are present and zero jobs", () => {
    expect(computeHelperTier(verifiedProfile, zeroStats)).toBe(1);
  });

  it("returns 1 when stats are missing/null but onboarding is complete", () => {
    expect(computeHelperTier(verifiedProfile, null)).toBe(1);
    expect(computeHelperTier(verifiedProfile, undefined)).toBe(1);
  });

  it("stays at 1 when one of the Trusted thresholds is just below", () => {
    const t = TIER_THRESHOLDS.trusted;
    // completedJobs short by one
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: t.completedJobs - 1,
        avgRating: t.avgRating,
        reviewCount: t.reviewCount,
      }),
    ).toBe(1);
    // avgRating short by 0.1
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: t.completedJobs,
        avgRating: t.avgRating - 0.1,
        reviewCount: t.reviewCount,
      }),
    ).toBe(1);
    // reviewCount short by one
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: t.completedJobs,
        avgRating: t.avgRating,
        reviewCount: t.reviewCount - 1,
      }),
    ).toBe(1);
  });
});

describe("computeHelperTier — Tier 2 (Trusted)", () => {
  const t = TIER_THRESHOLDS.trusted;

  it("returns 2 at the exact boundary", () => {
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: t.completedJobs,
        avgRating: t.avgRating,
        reviewCount: t.reviewCount,
      }),
    ).toBe(2);
  });

  it("stays at 2 when one Top Rated threshold is just below", () => {
    const e = TIER_THRESHOLDS.elite;
    // completedJobs short
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: e.completedJobs - 1,
        avgRating: e.avgRating,
        reviewCount: e.reviewCount,
      }),
    ).toBe(2);
    // avgRating short
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: e.completedJobs,
        avgRating: e.avgRating - 0.01,
        reviewCount: e.reviewCount,
      }),
    ).toBe(2);
    // reviewCount short
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: e.completedJobs,
        avgRating: e.avgRating,
        reviewCount: e.reviewCount - 1,
      }),
    ).toBe(2);
  });
});

describe("computeHelperTier — Tier 3 (Top Rated)", () => {
  const e = TIER_THRESHOLDS.elite;

  it("returns 3 at the exact boundary", () => {
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: e.completedJobs,
        avgRating: e.avgRating,
        reviewCount: e.reviewCount,
      }),
    ).toBe(3);
  });

  it("returns 3 well above the boundary", () => {
    expect(
      computeHelperTier(verifiedProfile, {
        completedJobs: 200,
        avgRating: 5.0,
        reviewCount: 150,
      }),
    ).toBe(3);
  });

  it("drops to 0 if onboarding is incomplete, regardless of stats", () => {
    expect(
      computeHelperTier(
        { ...verifiedProfile, stripe_account_id: null },
        { completedJobs: 200, avgRating: 5.0, reviewCount: 150 },
      ),
    ).toBe(0);
  });
});

describe("describeTierProgress", () => {
  it("at tier 0, lists every missing onboarding signal", () => {
    const hint = describeTierProgress(
      0,
      { idv_status: "not_started", stripe_account_id: null },
      zeroStats,
    );
    expect(hint.nextTier).toBe(1);
    // Two signals: Stripe identity + Stripe Connect. "Finish account approval"
    // went with the approval step (Q205b).
    expect(hint.missing).toEqual(["Finish Stripe identity verification", "Connect Stripe for payouts"]);
  });

  it("at tier 1, counts the exact gap to Trusted", () => {
    const t = TIER_THRESHOLDS.trusted;
    const hint = describeTierProgress(1, verifiedProfile, {
      completedJobs: t.completedJobs - 2,
      avgRating: t.avgRating - 0.2,
      reviewCount: t.reviewCount - 1,
    });
    expect(hint.nextTier).toBe(2);
    // Three deficits → three bullets.
    expect(hint.missing.length).toBe(3);
    expect(hint.missing.some((m) => m.includes("2 more completed jobs"))).toBe(true);
    expect(hint.missing.some((m) => m.includes("1 more review"))).toBe(true);
  });

  it("at tier 2, counts the gap to Top Rated", () => {
    const e = TIER_THRESHOLDS.elite;
    const hint = describeTierProgress(2, verifiedProfile, {
      completedJobs: e.completedJobs - 3,
      avgRating: e.avgRating,
      reviewCount: e.reviewCount,
    });
    expect(hint.nextTier).toBe(3);
    expect(hint.missing).toEqual(["3 more completed jobs"]);
  });

  it("at tier 3, nextTier is null and there is nothing to chase", () => {
    const hint = describeTierProgress(3, verifiedProfile, {
      completedJobs: 50,
      avgRating: 4.9,
      reviewCount: 30,
    });
    expect(hint.nextTier).toBeNull();
    expect(hint.missing).toEqual([]);
  });

  it("pluralizes the 'job'/'jobs' suffix correctly at the boundary", () => {
    const t = TIER_THRESHOLDS.trusted;
    const oneShortJob = describeTierProgress(1, verifiedProfile, {
      completedJobs: t.completedJobs - 1,
      avgRating: t.avgRating,
      reviewCount: t.reviewCount,
    });
    expect(oneShortJob.missing).toContain("1 more completed job");
  });
});

// Tier 1 is a publicly-rendered "Verified" claim, so it needs Stripe Identity's
// verdict. Reading the Connect flag hands the rung to everyone who set up payouts.
// @mutate src/lib/helperTier.ts |   hasIdBadge(profile?.idv_status); |   profile?.idv_status !== "failed";
