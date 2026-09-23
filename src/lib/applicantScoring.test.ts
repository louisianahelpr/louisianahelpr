import { describe, it, expect } from "vitest";

import {
  PRIORITY_PLACEMENT_MAX_POINTS,
  priorityPlacementPoints,
  scoreApplicant,
  signalsAriaLabel,
  type ApplicantData,
} from "./applicantScoring";
import { TIER_ORDER, TIER_PERK_MATRIX } from "../../supabase/functions/_shared/tierPerks";

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
  distanceBandRank: null,
  responseTimeMinutes: null,
  neighborCount: 0,
};

const at = (over: Partial<ApplicantData>): ApplicantData => ({ ...BLANK, ...over });

describe("priorityPlacementPoints", () => {
  /**
   * DERIVED FROM THE PERK MATRIX, NEVER HAND-LISTED — and this file learned
   * that the hard way. Until 2026-09-21 this test named exactly four tiers:
   * elite, pro, basic, free. Re-introducing CC-019 verbatim —
   *
   *     if (!["pro", "elite"].includes(String(tier ?? "").toLowerCase())) return 0;
   *
   * i.e. the hand-typed tier list that scored a paying Plus member at ZERO
   * placement points while TIER_PERK_MATRIX.plus.priorityPlacement is true and
   * the storefront sells Plus as "everything in Pro" — left this suite
   * **8 of 8 green**. The one tier the bug was about was the one tier nobody
   * had written down. That is the `registries-checked-against-themselves`
   * shape: a list cannot fail for a member it never had.
   *
   * So the inventory is TIER_ORDER and the oracle is TIER_PERK_MATRIX, the
   * same table `hasPerk` reads. A tier added tomorrow is asserted tomorrow,
   * and a `priorityPlacementPoints` that stops consulting the matrix fails
   * here on the first tier it forgets.
   */
  it("agrees with TIER_PERK_MATRIX on every tier that exists, not a hand list", () => {
    const entitled = TIER_ORDER.filter((t) => TIER_PERK_MATRIX[t].priorityPlacement);
    expect(
      entitled.length,
      "the matrix grants Priority Placement to nobody — this walk would be vacuous",
    ).toBeGreaterThanOrEqual(3);
    expect(
      TIER_ORDER.length - entitled.length,
      "every tier is entitled — the zero case would go unasserted",
    ).toBeGreaterThanOrEqual(2);

    const top = TIER_ORDER[TIER_ORDER.length - 1];
    const wrong: string[] = [];
    for (const tier of TIER_ORDER) {
      const want = !TIER_PERK_MATRIX[tier].priorityPlacement
        ? 0
        : tier === top
          ? PRIORITY_PLACEMENT_MAX_POINTS
          : PRIORITY_PLACEMENT_MAX_POINTS / 2;
      const got = priorityPlacementPoints(tier);
      if (got !== want) wrong.push(`${tier}: scored ${got}, matrix says ${want}`);
      // The fee ladder normalises case; so must this, for every tier.
      const upper = priorityPlacementPoints(tier.toUpperCase());
      if (upper !== want) wrong.push(`${tier.toUpperCase()}: scored ${upper}, matrix says ${want}`);
      // And the boost must actually reach the rank the poster's list is sorted
      // by — a tier that is paid for and scores 0 there is the whole defect.
      const boost = scoreApplicant(at({ priorityTier: tier })).priorityBoost;
      if (boost !== want) wrong.push(`scoreApplicant(${tier}).priorityBoost = ${boost}, matrix says ${want}`);
    }
    expect(wrong, "priorityPlacementPoints disagrees with TIER_PERK_MATRIX").toEqual([]);
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

// Q248 — "4.9★" reads to a screen reader as "4.9 black star" (Unicode's name
// for ★), not "4.9 stars". signalsAriaLabel is the sr-only text ApplicantsPanel
// renders alongside the aria-hidden glyph.
describe("signalsAriaLabel", () => {
  it("replaces the star glyph with a readable word (can fail on the raw glyph)", () => {
    expect(signalsAriaLabel(["4.9★"])).toBe("4.9 stars");
  });

  it("leaves signals with no star glyph untouched", () => {
    expect(signalsAriaLabel(["12 jobs", "On time", "Licensed"])).toBe("12 jobs, On time, Licensed");
  });

  it("joins a mix the same way the visible row does, minus the glyph", () => {
    expect(signalsAriaLabel(["4.9★", "12 jobs"])).toBe("4.9 stars, 12 jobs");
  });
});
// Proof this guard can fail (scripts/vacuity).
//
// The FIRST mutation is CC-019 itself, retyped: the hand-listed tier gate that
// scored a paying Plus member at zero placement points. Before 2026-09-21 this
// file survived it 8/8 green, because the four tiers it named by hand did not
// include the one the bug was about. It is registered here as the permanent
// proof that the matrix-derived walk above actually looks at Plus.
// @mutate src/lib/applicantScoring.ts | if (!hasPerk(tier, "priorityPlacement")) return 0; | if (!["pro", "elite"].includes(String(tier ?? "").toLowerCase())) return 0;
// The second is the "make the perk feel stronger" change: money outranking merit.
// @mutate src/lib/applicantScoring.ts | export const PRIORITY_PLACEMENT_MAX_POINTS = 2; | export const PRIORITY_PLACEMENT_MAX_POINTS = 20;
