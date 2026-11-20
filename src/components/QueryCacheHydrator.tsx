import { useEffect } from "react";
import { persistOptions, restorePersistedEarly } from "@/lib/queryPersister";
import { queryClient } from "@/lib/queryClient";

/**
 * Owner decision 11-20 (Home speed for returning members): when the entry's early IndexedDB read has already answered
 * (src/boot/persistedCacheEarly.ts), the saved cache is restored HERE, as this module evaluates, which is before
 * main.tsx's first render. Home then draws once, with the saved answers in place, instead of drawing and then
 * re-rendering when the restore landed after mount (that second draw was returning /home's largest paint: lab
 * 4208/4564/4264 ms with it, 4028/3992/3860 without). Answers already in the cache are never replaced by older saved
 * ones (hydrate keeps the newer). When the read has not answered, the restore runs after mount, as below.
 */
const restoredEarly = restorePersistedEarly(queryClient);

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
 * Restored early (above): only the save subscription starts here.
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
        const { persistQueryClient, persistQueryClientSubscribe } = await import(
          "@tanstack/react-query-persist-client"
        );
        if (cancelled) return;
        if (restoredEarly) {
          unsubscribe = persistQueryClientSubscribe({ queryClient, ...persistOptions });
          return;
        }
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
