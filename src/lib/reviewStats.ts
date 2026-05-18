/**
 * Aggregates raw review rows into per-reviewee rating stats.
 *
 * Given a flat list of `{ reviewee_id, rating }` rows, returns a Map keyed by
 * `reviewee_id` whose values hold the review `count` and the mean `avg`
 * rating. Reviewees with no rows are simply absent from the Map — callers
 * should default to `{ count: 0, avg: 0 }` when a key is missing.
 */
export function aggregateRatings(
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
