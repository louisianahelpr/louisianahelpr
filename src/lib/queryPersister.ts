/**
 * React Query persistence to IndexedDB (via idb-keyval).
 *
 * Why: cold-starts on Capacitor + web should feel instant. Persisting the
 * React Query cache to disk means returning users see last-known data
 * immediately while React Query revalidates in the background. Without
 * this, every cold start spins on a loader until Supabase responds.
 *
 * Why IndexedDB and not localStorage:
 *  - localStorage is synchronous and string-only; large query caches can
 *    block the main thread on read/write and bump into the ~5 MB quota.
 *  - IndexedDB (idb-keyval is a tiny promise wrapper) is async, larger,
 *    and works inside Capacitor's WKWebView/Chromium just as well as on
 *    desktop browsers.
 *
 * Safety: the storage adapter is constructed lazily and only references
 * idb-keyval through a function call at runtime — no IndexedDB access
 * happens at module import time, so SSR / pre-render passes don't crash.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query } from "@tanstack/react-query";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

/**
 * Async storage adapter conforming to TanStack's `AsyncStorage` shape.
 * idb-keyval transparently stores the JSON string under a single key in
 * its default IndexedDB database (`keyval-store`).
 */
const idbAsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const value = await get<string>(key);
    return value ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    await del(key);
  },
};

/**
 * Cache buster — bump (or rely on VITE_APP_VERSION bumping) any time the
 * persisted cache shape changes in a backward-incompatible way so old
 * payloads are discarded instead of hydrated into the new code path.
 */
const CACHE_BUSTER =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "v1";

/**
 * 24 hours. The default `gcTime` on the QueryClient must be >= this for
 * persisted entries to survive hydration — TanStack drops anything whose
 * `gcTime` has elapsed at restore time.
 */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24;

export const queryCachePersister = createAsyncStoragePersister({
  storage: idbAsyncStorage,
  key: "helpr-rq-cache",
  // Coalesce frequent writes (e.g. during a list-scroll that refetches
  // pages) into a single IndexedDB transaction per second.
  throttleTime: 1000,
});

export const persistOptions = {
  persister: queryCachePersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: CACHE_BUSTER,
  /**
   * Per-query opt-out via `meta: { persist: false }`. Auth-sensitive
   * queries (anything keyed to the current session that would mislead a
   * logged-out viewer if it persisted into a fresh install) should set
   * this. The default 60s staleTime still triggers a revalidation on any
   * query that does get rehydrated, so a one-minute-stale snapshot is
   * the worst case for anything that forgets to opt out.
   */
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) => {
      const meta = query.meta as { persist?: boolean } | undefined;
      if (meta?.persist === false) return false;
      // Defer the rest of the policy (success-only, etc.) to the upstream
      // default — it already filters out pending/errored queries.
      return defaultShouldDehydrateQuery(query);
    },
  },
} as const;
