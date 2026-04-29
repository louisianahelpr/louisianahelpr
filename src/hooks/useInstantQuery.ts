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
    /** True only on the very first load when we have nothing to show yet. */
    isInitialLoading: query.isLoading && query.data === undefined && fallback === undefined,
  };
}
