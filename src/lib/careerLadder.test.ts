import { describe, it, expect } from "vitest";
import { getEarnedMilestones, MIN_RATING_REVIEWS, type MilestoneStats } from "./careerLadder";

/**
 * VN-14 (owner, 2026-09-14): "in order to get the badges is it correctly
 * tracked". The seed account that prompted it — Hallie Helper, 16 jobs worked,
 * ONE 5.0 review — wore "Trusted Helpr", whose rule is a 4.5+ average.
 */

const base: MilestoneStats = {
  completedJobs: 0,
  avgRating: 0,
  reviewCount: 0,
  repeatHirePercent: 0,
  credentialTier: 0,
};
const ids = (s: Partial<MilestoneStats>) => getEarnedMilestones({ ...base, ...s }).map((m) => m.id);
const everything: MilestoneStats = {
  completedJobs: 500,
  avgRating: 5,
  reviewCount: 500,
  repeatHirePercent: 100,
  credentialTier: 3,
};

describe("career ladder — rating badges need a review floor", () => {
  it("one 5.0 review does not earn Trusted Helpr (the Hallie Helper case)", () => {
    const earned = ids({ completedJobs: 16, avgRating: 5, reviewCount: 1 });
    expect(earned).not.toContain("trusted_helpr");
    // The job-count badges are unaffected by the review floor.
    expect(earned).toEqual(expect.arrayContaining(["first_job", "rising_star"]));
  });

  it(`earns Trusted Helpr at exactly ${MIN_RATING_REVIEWS} reviews`, () => {
    expect(ids({ completedJobs: 10, avgRating: 4.5, reviewCount: MIN_RATING_REVIEWS - 1 })).not.toContain("trusted_helpr");
    expect(ids({ completedJobs: 10, avgRating: 4.5, reviewCount: MIN_RATING_REVIEWS })).toContain("trusted_helpr");
  });

  it("applies the floor to Community Pillar and Master Helpr too", () => {
    const thin = ids({ ...everything, reviewCount: MIN_RATING_REVIEWS - 1 });
    expect(thin).not.toContain("community_pillar");
    expect(thin).not.toContain("master_helpr");
    expect(thin).toContain("elite_helpr");
  });

  it("every rating badge carries the floor and says so in its description", () => {
    const rated = getEarnedMilestones(everything).filter((m) => m.requirement.avgRating);
    expect(rated.map((m) => m.id).sort()).toEqual(["community_pillar", "master_helpr", "trusted_helpr"]);
    for (const m of rated) {
      expect(m.requirement.minReviews).toBe(MIN_RATING_REVIEWS);
      expect(m.description).toContain(`${MIN_RATING_REVIEWS}+ reviews`);
    }
  });
});

describe("career ladder — descriptions state the rule they sit on", () => {
  it("Community Pillar describes a repeat-hire PERCENTAGE, not a count of posters", () => {
    const pillar = getEarnedMilestones(everything).find((m) => m.id === "community_pillar")!;
    expect(pillar.requirement.repeatHirePercent).toBe(20);
    expect(pillar.description).toContain("20%+ repeat hires");
    expect(pillar.description).not.toMatch(/repeat posters/);
    expect(ids({ ...everything, repeatHirePercent: 19 })).not.toContain("community_pillar");
  });
});

describe("career ladder — an unknown credential tier", () => {
  it("withholds Licensed Pro without touching any other badge", () => {
    const unknown = ids({ ...everything, credentialTier: null });
    expect(unknown).not.toContain("licensed_pro");
    expect(unknown).toContain("master_helpr");
    expect(ids({ credentialTier: 2 })).toEqual(["licensed_pro"]);
  });
});

// The review FLOOR is the line VN-14 bought: a rating rule without a sample
// size let one 5.0 review wear "Trusted Helpr" on the seed account the owner
// was looking at.
// @mutate src/lib/careerLadder.ts | if (r.minReviews && stats.reviewCount < r.minReviews) return false; | if (false) return false;
// Both registrations below re-verified killed on 2026-09-21 (guard burn-down,
// src/lib lane) — this file was already registered before the lane ran.
// The credential tier must treat UNKNOWN (null) as "withhold", not "grant".
// @mutate src/lib/careerLadder.ts | (stats.credentialTier === null \|\| stats.credentialTier < r.credentialTier) | (false)
