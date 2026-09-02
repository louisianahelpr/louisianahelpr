import { describe, it, expect } from "vitest";

import {
  PRIORITY_PLACEMENT_MAX_POINTS,
  priorityPlacementPoints,
  scoreApplicant,
  type ApplicantData,
} from "./applicantScoring";

/**
 * Priority Placement is a perk people are CHARGED for on a surface where a
 * poster is choosing which stranger to let into their home. Two things have to
 * stay true at once and they pull in opposite directions, so both are pinned
 * here rather than left to a comment:
 *
 *   1. The perk is REAL — a paying applicant genuinely outranks an otherwise
 *      identical free one. It shipped broken (useApplicantsState sorted by
 *      tier, useApplicantComparison immediately re-sorted by a scorer that
 *      took no tier), so "it does nothing" is a regression this file catches.
 *   2. The perk cannot OUTRANK MERIT. The boost is capped below the smallest
 *      single quality increment the scorer awards, so it settles near-ties and
 *      nothing more.
 */
const BLANK: ApplicantData = {
  userId: "u",
  avgRating: null,
  reviewCount: 0,
  completedJobs: 0,
  repeatHirePercent: null,
  onTimePercent: null,
  credentialTier: 0,
  distanceKm: null,
  responseTimeMinutes: null,
  neighborCount: 0,
};

const at = (over: Partial<ApplicantData>): ApplicantData => ({ ...BLANK, ...over });

describe("priorityPlacementPoints", () => {
  it("pays only the tiers that actually advertise Priority Placement", () => {
    // TIER_PERKS: pro.priorityPlacement === true, elite.priorityPlacement ===
    // true, basic.priorityPlacement === false. Basic buys early access and
    // instant payouts, not placement — charging for it here would be the
    // mirror image of the bug this file exists for.
    expect(priorityPlacementPoints("elite")).toBe(PRIORITY_PLACEMENT_MAX_POINTS);
    expect(priorityPlacementPoints("pro")).toBe(PRIORITY_PLACEMENT_MAX_POINTS / 2);
    expect(priorityPlacementPoints("basic")).toBe(0);
    expect(priorityPlacementPoints("free")).toBe(0);
  });

  it("gives an unknown, absent or retired tier nothing", () => {
    // Same direction as DEFAULT_TIER_FEE_PERCENT: an unrecognised value must
    // lose a perk, never gain one. 'business' was retired on 2026-09-01.
    expect(priorityPlacementPoints(null)).toBe(0);
    expect(priorityPlacementPoints(undefined)).toBe(0);
    expect(priorityPlacementPoints("business")).toBe(0);
    expect(priorityPlacementPoints("gold-plated")).toBe(0);
  });

  it("normalises case, like the fee ladder does", () => {
    expect(priorityPlacementPoints("ELITE")).toBe(PRIORITY_PLACEMENT_MAX_POINTS);
  });
});

describe("scoreApplicant — the boost is bounded, never an override", () => {
  it("keeps `score` free of paid signal and puts the boost in `rankScore`", () => {
    // The "Helpr Recommended" badge reads `score`. If the boost ever leaks
    // into it, the app's own endorsement becomes purchasable.
    const free = scoreApplicant(at({ avgRating: 4.9, reviewCount: 10 }));
    const elite = scoreApplicant(at({ avgRating: 4.9, reviewCount: 10, priorityTier: "elite" }));
    expect(elite.score).toBe(free.score);
    expect(elite.rankScore).toBe(free.score + PRIORITY_PLACEMENT_MAX_POINTS);
    expect(free.rankScore).toBe(free.score);
  });

  it("is capped BELOW the smallest single quality increment", () => {
    // This inequality is the whole argument. If someone later raises the boost
    // to "make the perk feel stronger", this fails and tells them what they
    // are actually about to sell: rank over merit.
    const oneCredentialRung = scoreApplicant(at({ credentialTier: 1 })).score;
    const firstCompletedJob = scoreApplicant(at({ completedJobs: 1 })).score;
    const smallRatingGap =
      scoreApplicant(at({ avgRating: 4.9, reviewCount: 3 })).score -
      scoreApplicant(at({ avgRating: 4.6, reviewCount: 3 })).score;

    expect(PRIORITY_PLACEMENT_MAX_POINTS).toBeLessThan(oneCredentialRung);
    expect(PRIORITY_PLACEMENT_MAX_POINTS).toBeLessThan(firstCompletedJob);
    expect(PRIORITY_PLACEMENT_MAX_POINTS).toBeLessThan(smallRatingGap);
  });

  it("lets a genuinely stronger FREE applicant beat a paying one", () => {
    // The case the owner asked to see. A free helper with one verified
    // credential outranks an Elite subscriber with none, and it is not close.
    const freeButLicensed = scoreApplicant(at({ userId: "free", credentialTier: 1 }));
    const eliteWithNothing = scoreApplicant(at({ userId: "elite", priorityTier: "elite" }));
    expect(freeButLicensed.rankScore).toBeGreaterThan(eliteWithNothing.rankScore);
  });

  it("settles an exact tie in the paying applicant's favour", () => {
    // Two brand-new helpers, no reviews, no history — which is what most of
    // this list looks like in practice. Here the perk decides, which is
    // exactly the space it is allowed to operate in.
    const free = scoreApplicant(at({ userId: "free" }));
    const pro = scoreApplicant(at({ userId: "pro", priorityTier: "pro" }));
    expect(free.score).toBe(pro.score);
    expect(pro.rankScore).toBeGreaterThan(free.rankScore);
  });

  it("does not let an expired tier pay — it arrives as null from the server", () => {
    // get_safe_profiles folds `subscription_expires_at` into the tier it
    // returns (migration 20260901022522), so a lapsed Elite reaches the client
    // as null. The client has no expiry date for another member and could not
    // resolve this itself, which is why the fix had to be in SQL.
    expect(scoreApplicant(at({ priorityTier: null })).priorityBoost).toBe(0);
  });
});
