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
 * Marker key used to round-trip a `Set` through JSON. Default
 * `JSON.stringify` turns a Set into `{}` (Sets have no enumerable own
 * properties), so any persisted query whose data holds a Set would
 * rehydrate it as a plain object and blow up the first time the consumer
 * calls `.has()`/`.add()`. The activity feed (useActivityData) returns
 * three such Sets — startRequestedJobIds, declinedJobIds,
 * helperReviewedJobIds — which is exactly how My Posts / My Jobs crashed
 * to an error boundary after a cold start rehydrated the persisted cache.
 */
const SET_MARKER = "__rq_set__";
/**
 * Sibling of SET_MARKER for `Map`. Same failure mode: `JSON.stringify(map)`
 * yields `{}`, so a persisted query whose data holds a Map (ScheduleTab's
 * blockedDates, useApplicantSignals' signal map) rehydrates as a plain object
 * and throws "X.has is not a function" on first use after a cold start.
 * Stored as its entry array so nested Sets/Maps in values round-trip too.
 */
const MAP_MARKER = "__rq_map__";

const serializeReplacer = (_key: string, value: unknown) => {
  if (value instanceof Set) return { [SET_MARKER]: Array.from(value) };
  if (value instanceof Map) return { [MAP_MARKER]: Array.from(value.entries()) };
  return value;
};

const deserializeReviver = (_key: string, value: unknown) => {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj[SET_MARKER])) {
      return new Set(obj[SET_MARKER] as unknown[]);
    }
    if (Array.isArray(obj[MAP_MARKER])) {
      return new Map(obj[MAP_MARKER] as [unknown, unknown][]);
    }
  }
  return value;
};

/**
 * Bumped to `-s2` when the Set-aware serializer landed, `-s3` when the
 * Map-aware serializer landed: pre-existing IndexedDB payloads still hold the
 * broken `{}`-shaped Sets/Maps, so the buster string must change to evict them
 * exactly once on the next load.
 */
const SERIALIZATION_VERSION = "s3";

/**
 * Cache buster — bump (or rely on VITE_APP_VERSION bumping) any time the
 * persisted cache shape changes in a backward-incompatible way so old
 * payloads are discarded instead of hydrated into the new code path.
 */
const CACHE_BUSTER = `${
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "v1"
}-${SERIALIZATION_VERSION}`;

/**
 * 24 hours. The default `gcTime` on the QueryClient must be >= this for
 * persisted entries to survive hydration — TanStack drops anything whose
 * `gcTime` has elapsed at restore time.
 */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24;

/**
 * idb-keyval entry key that backs the persisted React Query cache.
 * Exported so `removePersistedClient()` and the persister itself stay
 * in lockstep — a literal here and a literal in the persister would
 * drift silently if one is renamed.
 */
const PERSIST_CACHE_KEY = "helpr-rq-cache";

const queryCachePersister = createAsyncStoragePersister({
  storage: idbAsyncStorage,
  key: PERSIST_CACHE_KEY,
  // Coalesce frequent writes (e.g. during a list-scroll that refetches
  // pages) into a single IndexedDB transaction per second.
  throttleTime: 1000,
  // Set-aware (de)serialization — default JSON would flatten any Set in a
  // query's data to `{}` and crash the consumer on rehydration.
  serialize: (client) => JSON.stringify(client, serializeReplacer),
  deserialize: (cached) => JSON.parse(cached, deserializeReviver),
});

/**
 * Wipe the persisted React Query cache from IndexedDB.
 *
 * Called from the SIGNED_OUT auth handler so the next user on a shared
 * device doesn't rehydrate the prior user's data (Stripe payouts,
 * admin payout ledger, job history, notification logs). The 24h
 * `maxAge` on the persister would otherwise keep that data alive
 * across the sign-out boundary.
 *
 * Best-effort: idb-keyval can throw on private-mode browsers / quota
 * issues. We swallow the error rather than surface it to the user —
 * the in-memory `queryClient.clear()` paired with this call still
 * removes the privacy leak from THIS session, and the persister will
 * overwrite stale entries on the next write.
 */
export const removePersistedClient = async (): Promise<void> => {
  try {
    await del(PERSIST_CACHE_KEY);
  } catch {
    /* ignore — best-effort cleanup */
  }
};

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
