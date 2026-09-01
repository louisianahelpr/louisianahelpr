import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The single source of truth for "which reviews count toward a rating":
 * feedback must be past its anti-retaliation reveal (`feedback_visible_at`),
 * the review must still be `published`, AND the underlying job must not be
 * cancelled. Every rating aggregate — profile pages, feeds, applicant lists —
 * must apply all three or the numbers diverge across surfaces.
 *
 * WHY THIS GOES THROUGH AN RPC NOW.
 *
 * This function used to express the cancelled-job rule client-side as
 * `.select("reviewee_id, rating, jobs!inner(status)").neq("jobs.status",
 * "cancelled")`. That join runs through `public.jobs`, which RLS hides from
 * anyone who is not a party to the job — and the jobs behind SOMEONE ELSE'S
 * reviews are by definition third-party jobs. So the inner join matched
 * nothing and the query returned **zero rows for every viewer**.
 *
 * Measured against production on 2026-08-31 as an ordinary authenticated
 * user: the exact query above returned 0 rows; the same query without the
 * `jobs!inner` join returned 8. Every surface fed by this helper — the
 * applicant list, the dashboard helper rows, the guest dashboard — was
 * therefore rendering "no rating" for helpers who hold real 5-star reviews.
 * The failure is silent: no error, just an empty Map that reads exactly like
 * "this person has never been reviewed".
 *
 * `get_public_profile_stats` (migration 20260901002325) is the same three
 * predicates evaluated as `SECURITY DEFINER`, where `jobs` IS readable. It is
 * the fix that migration already shipped for the public profile page; this is
 * the call site it did not convert.
 */

/** What every caller consumes. Absent key ⇒ caller defaults to 0/0. */
export type RatingStats = Map<string, { count: number; avg: number }>;

interface PublicProfileStatsRow {
  user_id: string;
  review_count: number | null;
  avg_rating: number | null;
}

export async function fetchRatingStats(revieweeIds: string[]): Promise<RatingStats> {
  const ids = [...new Set(revieweeIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase.rpc(
    "get_public_profile_stats" as never,
    { p_user_ids: ids } as never,
  );

  // PGRST202 = the function is not deployed yet. Migrations land on merge to
  // main, so a freshly-shipped client can run for a window against a database
  // that has not caught up (CLAUDE.md). Degrade to the direct read rather than
  // showing every helper as unrated, which is the very bug this replaces.
  if (error && (error as { code?: string }).code !== "PGRST202") throw error;

  if (!error) {
    const map: RatingStats = new Map();
    for (const row of (data ?? []) as PublicProfileStatsRow[]) {
      const count = Number(row.review_count ?? 0);
      if (count > 0) map.set(row.user_id, { count, avg: Number(row.avg_rating ?? 0) });
    }
    return map;
  }

  // ── Fallback: direct read, deliberately WITHOUT the jobs join ────────────
  // The cancelled-job exclusion is not expressible here — `jobs` is
  // unreadable to this viewer, which is the whole reason the RPC exists — so
  // this can over-count by any review left on a job that went
  // completed → disputed → cancelled. That is a rounding-level inaccuracy on
  // a rare transition, and it is strictly better than the structural zero it
  // replaces. The reveal window and `published` status are still applied (and
  // the reveal is independently enforced by the reviews SELECT policy).
  const rows = unwrap(
    await supabase
      .from("reviews")
      .select("reviewee_id, rating")
      .in("reviewee_id", ids)
      .eq("status", "published")
      .lte("feedback_visible_at", new Date().toISOString()),
  );
  return aggregateRatings(rows as { reviewee_id: string; rating: number }[] | null);
}

/**
 * Aggregates raw review rows into per-reviewee rating stats.
 *
 * Given a flat list of `{ reviewee_id, rating }` rows, returns a Map keyed by
 * `reviewee_id` whose values hold the review `count` and the mean `avg`
 * rating. Reviewees with no rows are simply absent from the Map — callers
 * should default to `{ count: 0, avg: 0 }` when a key is missing.
 */
function aggregateRatings(
  rows: { reviewee_id: string; rating: number }[] | null | undefined,
): RatingStats {
  const map: RatingStats = new Map();
  for (const r of rows ?? []) {
    const existing = map.get(r.reviewee_id);
    if (existing) {
      existing.count += 1;
      existing.avg = (existing.avg * (existing.count - 1) + r.rating) / existing.count;
    } else {
      map.set(r.reviewee_id, { count: 1, avg: r.rating });
    }
  }
  return map;
}
