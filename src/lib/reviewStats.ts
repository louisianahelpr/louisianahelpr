import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The single source of truth for "which reviews count toward a rating":
 * feedback must be past its anti-retaliation reveal (`feedback_visible_at`)
 * AND the underlying job must not be cancelled. Every rating aggregate —
 * profile pages, feeds, applicant lists — must apply BOTH filters or the
 * numbers diverge across surfaces. Fetches for the given reviewees and
 * returns the aggregated per-reviewee map directly.
 */
export async function fetchRatingStats(
  revieweeIds: string[],
): Promise<Map<string, { count: number; avg: number }>> {
  const ids = [...new Set(revieweeIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const data = unwrap(
    await supabase
      .from("reviews")
      .select("reviewee_id, rating, jobs!inner(status)")
      .in("reviewee_id", ids)
      .lte("feedback_visible_at", new Date().toISOString())
      .neq("jobs.status", "cancelled"),
  );
  return aggregateRatings(data as { reviewee_id: string; rating: number }[] | null);
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
): Map<string, { count: number; avg: number }> {
  const map = new Map<string, { count: number; avg: number }>();
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
