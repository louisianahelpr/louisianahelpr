import { useEffect } from "react";
import { persistOptions, removePersistedClient } from "@/lib/queryPersister";
import { queryClient } from "@/lib/queryClient";
import { whenSessionConfirmed } from "@/hooks/useAuthReady";

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
      // Q1158: a member restored from an expired session sees nothing from the last visit until the server has
      // accepted the refresh; a refused refresh (signed out) skips the hydration (useAuthReady whenSessionConfirmed).
      // A refused restore also drops the last visit's cache from the device: main.tsx's SIGNED_OUT cleanup is
      // registered only later in the load, so the next cold load would otherwise hydrate it.
      if (!(await whenSessionConfirmed())) {
        void removePersistedClient();
        return;
      }
      if (cancelled) return;
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
