import { describe, it, expect } from "vitest";
import { buildHelperBadgeStats, helperSideFromRatings, helperSideReviews } from "./helperBadgeStats";

/**
 * VN-14: badges earned by working read reviews received AS A HELPR. The RPC's
 * `avg_rating` averages every review a person received, poster-side included
 * (verified live with pg_get_functiondef, 2026-09-14).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("helperSideReviews", () => {
  it("a pure poster has no helper-side reviews, whatever their rating", () => {
    expect(
      helperSideReviews({ review_count: 5, avg_rating: "5.00", poster_review_count: 5, poster_avg_rating: "5.00" }),
    ).toEqual({ reviewCount: 0, avgRating: null, exact: true });
  });

  it("with no poster-side reviews the published mean IS the helper mean (Hallie Helper, prod)", () => {
    expect(
      helperSideReviews({ review_count: 1, avg_rating: "5.00", poster_review_count: 0, poster_avg_rating: null }),
    ).toEqual({ reviewCount: 1, avgRating: 5, exact: true });
  });

  it("recovers the exact helper mean when the poster mean is published", () => {
    // 4 helper reviews (5,5,4,5) and 3 poster reviews (5,5,5).
    expect(
      helperSideReviews({ review_count: 7, avg_rating: "4.86", poster_review_count: 3, poster_avg_rating: "5.00" }),
    ).toEqual({ reviewCount: 4, avgRating: 4.75, exact: true });
  });

  it("with both sides reviewed it never overstates the helper mean", () => {
    // 3 helper reviews of 4, 2 poster reviews of 5 (poster mean withheld <3).
    const helper = [4, 4, 4];
    const poster = [5, 5];
    const all = [...helper, ...poster];
    const got = helperSideReviews({
      review_count: all.length,
      avg_rating: round2(mean(all)),
      poster_review_count: poster.length,
      poster_avg_rating: null,
    });
    expect(got.reviewCount).toBe(3);
    expect(got.exact).toBe(false);
    expect(got.avgRating!).toBeLessThanOrEqual(mean(helper));
    // The old input — the mixed mean — would have read 4.4.
    expect(round2(mean(all))).toBeGreaterThan(mean(helper));
  });

  it("the bound holds for every mix of 1-5 star reviews (exhaustive, small samples)", () => {
    const stars = [1, 2, 3, 4, 5];
    for (let h = 1; h <= 3; h++) {
      for (let p = 1; p <= 3; p++) {
        // Constant-per-side samples are enough to exercise the arithmetic at
        // every published-vs-withheld poster mean and every rounding edge.
        for (const hs of stars) {
          for (const ps of stars) {
            const helper = Array(h).fill(hs);
            const poster = Array(p).fill(ps);
            const all = [...helper, ...poster];
            const got = helperSideReviews({
              review_count: all.length,
              avg_rating: round2(mean(all)),
              poster_review_count: p,
              poster_avg_rating: p >= 3 ? round2(mean(poster)) : null,
            });
            expect(got.reviewCount).toBe(h);
            expect(got.avgRating!).toBeLessThanOrEqual(mean(helper) + 1e-9);
            // …and is the true mean whenever the poster mean was published.
            if (p >= 3) expect(got.avgRating!).toBeCloseTo(mean(helper), 9);
          }
        }
      }
    }
  });
});

describe("buildHelperBadgeStats", () => {
  it("counts jobs worked, not posted + worked, and keeps the 0-means-none rating contract", () => {
    expect(buildHelperBadgeStats(0, helperSideReviews({
      review_count: 5, avg_rating: 5, poster_review_count: 5, poster_avg_rating: 5,
    }))).toEqual({ completedJobs: 0, avgRating: 0, reviewCount: 0 });
    expect(buildHelperBadgeStats(16, helperSideFromRatings([5]))).toEqual({
      completedJobs: 16,
      avgRating: 5,
      reviewCount: 1,
    });
    expect(buildHelperBadgeStats(null, null)).toEqual({ completedJobs: 0, avgRating: 0, reviewCount: 0 });
  });
});

// The contract is a LOWER bound: a badge may be under-awarded, never
// over-awarded. Taking the high end of the total and the low end of the poster
// sum inverts exactly that, and nothing else about the module changes.
// @mutate src/lib/helperBadgeStats.ts | Math.max(helper * MIN_RATING, totalLo - posterHi) | Math.max(helper * MIN_RATING, totalHi - posterLo)
