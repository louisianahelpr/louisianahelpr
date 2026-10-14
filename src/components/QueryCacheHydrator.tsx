import { useEffect } from "react";
import { persistOptions } from "@/lib/queryPersister";
import { queryClient } from "@/lib/queryClient";

/**
 * Kicks off React Query cache hydration from IndexedDB AFTER first paint.
 *
 * The standard `PersistQueryClientProvider` wraps children in an
 * `IsRestoringProvider` that flips `isRestoring: true` until the async IDB
 * read finishes — that pauses every `useQuery` on the page (they sit at
 * `isLoading: true`) and effectively delays the *data* on first paint by
 * ~200-800ms even though the layout renders. By calling
 * `persistQueryClient` ourselves from a post-mount effect, queries fire
 * against the network immediately; cached entries fold in silently once
 * IDB finishes restoring. The worst case is a one-paint flicker on a
 * route that had cached data — still much better than a stalled spinner.
 *
 * The import is dynamic so the persist-client chunk (~3KB + idb-keyval)
 * stays off the entry bundle alongside the persister itself.
 */
const QueryCacheHydrator = () => {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { persistQueryClient } = await import(
          "@tanstack/react-query-persist-client"
        );
        if (cancelled) return;
        const [unsub] = persistQueryClient({
          queryClient,
          ...persistOptions,
        });
        unsubscribe = unsub;
      } catch {
        /* persistence is best-effort — never break the app */
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return null;
};

export default QueryCacheHydrator;
