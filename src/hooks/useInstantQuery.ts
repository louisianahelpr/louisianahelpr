import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";

/**
 * Drop-in replacement for the common
 *   `const [data, setData] = useState(null); useEffect(() => fetch().then(setData), [])`
 * pattern. Built on top of React Query so:
 *
 *   - First mount fetches and caches.
 *   - Re-mounts (e.g. switching tabs) render the cached data INSTANTLY and
 *     refetch in the background — no full-page spinner blocking the UI.
 *   - `staleTime` defaults to 60s so quick back-and-forth navigation skips
 *     refetches entirely.
 *
 * Usage:
 *   const { data, isFetching, refetch } = useInstantQuery({
 *     key: ["earnings", userId],
 *     fetcher: async () => { ... },
 *     fallback: { jobs: [], tips: [] }, // shape rendered before first fetch
 *   });
 *
 * The `fallback` lets you skip the "loading…" spinner entirely — render the
 * UI shell with empty defaults and let the real data slot in.
 */
export function useInstantQuery<T>({
  key,
  fetcher,
  fallback,
  enabled = true,
  staleTime = 60_000,
  gcTime = 5 * 60_000,
  ...rest
}: {
  key: QueryKey;
  fetcher: () => Promise<T>;
  fallback?: T;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
} & Omit<UseQueryOptions<T>, "queryKey" | "queryFn" | "staleTime" | "gcTime" | "enabled">) {
  const query = useQuery<T>({
    queryKey: key,
    queryFn: fetcher,
    enabled,
    staleTime,
    gcTime,
    ...rest,
  });

  return {
    ...query,
    /**
     * Best value to render: the real data if we have it, otherwise the
     * caller-provided fallback shell. Components can render unconditionally.
     */
    data: (query.data ?? fallback) as T,
    /**
     * True on the very first load, while there is nothing real to show yet.
     *
     * The original rule was `fallback === undefined` — i.e. "a fallback means
     * we have a shell to render, so this isn't a blank first load." That
     * intent is right and `useInstantQuery.test.tsx:63` pins it.
     *
     * The gap was that 15 admin surfaces pass `fallback: []`, and an EMPTY
     * array is not a shell — it renders as the EMPTY STATE. So their skeletons
     * were unreachable and first paint asserted a falsehood:
     * AdminFraudDashboard opened on "No unresolved fraud flags — looking
     * good!" and AdminPayoutBatches on "All payouts are settled. Nothing to
     * send." — while the read was still in flight. Telling an operator there
     * is no fraud because the query hasn't finished is the worst version of
     * this bug.
     *
     * So: a fallback still suppresses the skeleton, but an empty one doesn't
     * count as having something to show.
     *
     * `query.isLoading` is `isPending && isFetching` in TanStack v5, so a
     * DISABLED query reports false here — this cannot produce a permanent
     * skeleton the way a bare `isPending` can.
     */
    isInitialLoading:
      query.isLoading &&
      query.data === undefined &&
      (fallback === undefined || (Array.isArray(fallback) && fallback.length === 0)),
  };
}
