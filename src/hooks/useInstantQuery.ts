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
 * The `fallback` gives `data` its shape before the first fetch, so the
 * component can render unconditionally. It is NOT a reading: anything that
 * would state a number, an empty state or an alarm from it waits on
 * `isInitialLoading` (Q1287).
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
     * The same was true of an OBJECT fallback (Q1287): it is a shell of
     * zeros, and it rendered as a reading. The admin health screen opened on
     * "0 sent", "0 unresolved" and the red "No admin has registered a push
     * token" banner (measured on prod 2026-10-12 with the reads held: the
     * loaded values were 8 sent, 87 suppressed, 5 unresolved), and the
     * spinner/skeleton branches of AdminStalledJobs and AdminReferrals, whose
     * fallbacks are objects, could never render. No fallback is data.
     *
     * So: until the first answer, isInitialLoading is true whatever the
     * fallback. The fallback still gives `data` its shape, so a caller that
     * never reads isInitialLoading renders exactly as before.
     *
     * `query.isLoading` is `isPending && isFetching` in TanStack v5, so a
     * DISABLED query reports false here — this cannot produce a permanent
     * skeleton the way a bare `isPending` can.
     *
     * PAUSED counts too (Q571). Offline, a query that has never answered is
     * paused, not fetching, so isLoading is false and the empty fallback
     * rendered as the EMPTY STATE: "Nothing to send. Every payout is settled."
     * to an operator who is merely offline. A paused first load is still a
     * first load; it resumes by itself when the connection returns.
     */
    isInitialLoading:
      (query.isLoading || query.fetchStatus === "paused") &&
      query.data === undefined,
  };
}
