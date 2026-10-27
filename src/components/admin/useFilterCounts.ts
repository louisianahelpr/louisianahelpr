import { useQueries, type QueryKey } from "@tanstack/react-query";

/**
 * THE NUMBER ON EACH ADMIN FILTER PILL (owner, 2026-10-27: "pending, resolved
 * and all each need the number of items in each").
 *
 * Each pill's count is the length of the very list that pill shows: the same
 * query key and the same fetcher the view's own list uses (useInstantQuery,
 * same staleTime/gcTime), so React Query serves both from ONE cache entry. A
 * pill can never say 6 over a list of 5, and picking a pill whose count has
 * loaded shows its list at once.
 *
 * A count that has not loaded, or whose read failed, is absent: the pill then
 * shows its bare label, never a guessed 0.
 * Guard: src/test/adminFilterPillsShowCounts.test.ts.
 */
export function useFilterCounts<F, T>(
  filters: readonly F[],
  keyFor: (filter: F) => QueryKey,
  fetchFor: (filter: F) => Promise<T>,
  countOf: (data: T) => number,
): Map<F, number> {
  const results = useQueries({
    queries: filters.map((f) => ({
      queryKey: keyFor(f),
      queryFn: () => fetchFor(f),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    })),
  });
  const counts = new Map<F, number>();
  filters.forEach((f, i) => {
    const r = results[i];
    if (r && r.data !== undefined) counts.set(f, countOf(r.data as T));
  });
  return counts;
}

/** "Pending (6)", the form the admin pill rows that already had counts use (Jobs, Disputes, Payouts, Tiers, Referrals). */
export const pillLabel = (label: string, count: number | undefined): string =>
  count === undefined ? label : `${label} (${count})`;
