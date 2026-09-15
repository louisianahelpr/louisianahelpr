/**
 * THE INPUTS FOR EVERY BADGE EARNED BY WORKING (owner, 2026-09-14, VN-14: "in
 * order to get the badges is it correctly tracked").
 *
 * The career milestones (First Job … Master Helpr, `careerLadder.ts`) and the
 * verification ladder's Trusted / Top Rated rungs (`helperTier.ts`) are all
 * claims about someone AS A HELPR. They were fed from the profile's headline
 * numbers instead:
 *
 *   - job count  — `completed_jobs_total`, every completed job the person was
 *                  on, POSTED or worked. Someone who had only ever posted five
 *                  jobs read "Rising Star · 5 jobs completed".
 *   - rating     — `avg_rating`, the mean of every review they RECEIVED, as a
 *                  poster too (verified live, `pg_get_functiondef`, 2026-09-14:
 *                  `visible_reviews` is every published review with
 *                  `reviewee_id` = them; `as_poster` only splits the COUNT).
 *
 * The headline tiles keep those numbers — "5.0 · 1 review" is one rating for
 * one person (owner, 2026-09-11: "no one rating"). Badges read this instead.
 *
 * Both surfaces that draw these badges — the public profile (RecognitionRow)
 * and the owner's own Profile landing (HelperTierBadge) — build their inputs
 * here, so they cannot disagree about the same person.
 */

export interface HelperBadgeStats {
  /** Completed jobs where this person was the `helper_id`. */
  completedJobs: number;
  /** Mean of reviews received AS A HELPR. 0 when unknown or none — the
   *  `computeHelperTier` / `getEarnedMilestones` contract; a 0 never renders. */
  avgRating: number;
  /** Reviews received AS A HELPR. */
  reviewCount: number;
}

/** The review aggregates `get_public_profile_stats` publishes. */
export interface ReviewAggregates {
  review_count: number | string | null | undefined;
  avg_rating: number | string | null | undefined;
  poster_review_count: number | string | null | undefined;
  poster_avg_rating: number | string | null | undefined;
}

export interface HelperSideReviews {
  reviewCount: number;
  /** `null` when there is nothing to average. */
  avgRating: number | null;
  /** False when `avgRating` is a conservative bound, not the exact mean. */
  exact: boolean;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `avg_rating` / `poster_avg_rating` are ROUND(…, 2) in SQL. */
const ROUNDING = 0.005;
/** `reviews.rating` is an INTEGER with CHECK (rating >= 1 AND rating <= 5). */
const MIN_RATING = 1;
const MAX_RATING = 5;
const EPS = 1e-9;

/**
 * The integer rating SUM behind a 2-decimal mean of `count` reviews, as a
 * [lo, hi] range. Ratings are whole stars, so for fewer than 100 reviews the
 * range is a single integer and the sum is recovered exactly.
 */
function sumRange(count: number, roundedMean: number): [number, number] {
  const lo = Math.max(count * MIN_RATING, Math.ceil(count * (roundedMean - ROUNDING) - EPS));
  const hi = Math.min(count * MAX_RATING, Math.floor(count * (roundedMean + ROUNDING) + EPS));
  return [lo, Math.max(lo, hi)];
}

/**
 * Helper-side review count and mean, recovered from the RPC's aggregates.
 *
 * The COUNT is exact: `review_count - poster_review_count`.
 *
 * The MEAN: the RPC publishes no helper-only mean (that needs a new
 * `get_public_profile_stats` column). It is recovered from the published
 * numbers — every review is a whole 1-5 star, so a 2-decimal mean pins down
 * the integer sum behind it:
 *
 *   - no poster-side reviews   → every review is a helper review; exact.
 *   - poster mean published    → helper sum = total sum - poster sum; exact
 *     (3+ poster reviews)        below 100 reviews per side.
 *   - poster mean withheld     → the poster sum is unknown, so this returns
 *     (1-2 poster reviews)       the LOWEST helper mean the numbers allow
 *                                (poster reviews assumed 5 stars).
 *
 * Whenever it cannot be exact it is a lower bound: a badge gated on it can be
 * under-awarded, never over-awarded.
 */
export function helperSideReviews(agg: ReviewAggregates): HelperSideReviews {
  const total = Math.max(0, Math.round(num(agg.review_count) ?? 0));
  const poster = Math.min(total, Math.max(0, Math.round(num(agg.poster_review_count) ?? 0)));
  const helper = total - poster;
  const avg = num(agg.avg_rating);
  if (helper === 0 || avg === null) return { reviewCount: helper, avgRating: null, exact: true };
  // Every review is a helper review: the published mean, as displayed.
  if (poster === 0) return { reviewCount: helper, avgRating: avg, exact: true };

  const [totalLo, totalHi] = sumRange(total, avg);
  const posterAvg = num(agg.poster_avg_rating);
  const [posterLo, posterHi]: [number, number] =
    posterAvg === null ? [poster * MIN_RATING, poster * MAX_RATING] : sumRange(poster, posterAvg);

  const helperSumLo = Math.min(helper * MAX_RATING, Math.max(helper * MIN_RATING, totalLo - posterHi));
  const exact = totalLo === totalHi && posterLo === posterHi;
  return { reviewCount: helper, avgRating: helperSumLo / helper, exact };
}

/** Exact helper-side count and mean from individual ratings (client fallback). */
export function helperSideFromRatings(ratings: readonly number[]): HelperSideReviews {
  const valid = ratings.filter((r) => Number.isFinite(r));
  return {
    reviewCount: valid.length,
    avgRating: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    exact: true,
  };
}

export function buildHelperBadgeStats(
  completedJobsAsHelper: number | null | undefined,
  reviews: Pick<HelperSideReviews, "reviewCount" | "avgRating"> | null | undefined,
): HelperBadgeStats {
  return {
    completedJobs: Math.max(0, Math.floor(completedJobsAsHelper ?? 0)),
    avgRating: reviews?.avgRating ?? 0,
    reviewCount: reviews?.reviewCount ?? 0,
  };
}
