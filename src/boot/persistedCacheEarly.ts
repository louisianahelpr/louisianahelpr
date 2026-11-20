/**
 * Read the member's persisted React Query cache from IndexedDB on the FIRST network round, so the app can restore it
 * BEFORE its first render (owner decision 11-20, Home speed for returning members).
 *
 * WHY. QueryCacheHydrator restored the cache only after Home had mounted (~3.6 s on the lab's Slow 4G phone). The
 * restore folded older answers into Home and re-rendered it: the Your page line moved down, was drawn again, and that
 * second draw became the largest paint. Lab (cwv-lab mobile, --return, 3 runs, ~/.lh-shots/home-boot-js-1120): returning
 * /home LCP 4208/4564/4264 ms with the after-mount restore, 4028/3992/3860 without it. The read itself is quick; it
 * only started too late. Here it starts while the app downloads, and main.tsx restores it before React renders when it
 * has answered (src/lib/queryPersister.ts restorePersistedEarly). When it has not, nothing changes: the hydrator
 * restores after mount, as before.
 *
 * Raw IndexedDB, not idb-keyval: this file rides in the entry's signedInPrefetch chunk, which must import nothing
 * from src/lib (its importing app-shared would hold every prefetch until the 45 KB chunk downloads). The database,
 * store and key are idb-keyval's defaults and queryPersister.ts's key; src/test/persistedCacheEarly.test.ts holds them
 * equal. An upgrade (no database yet) creates the store exactly as idb-keyval does, so idb-keyval later finds it.
 *
 * NOTHING outside the entry's chunks may import this file (see guestJobsPrefetch.ts).
 */

/** idb-keyval's default database and store (createStore("keyval-store", "keyval")). */
export const KEYVAL_DB = "keyval-store";
export const KEYVAL_STORE = "keyval";
/** queryPersister.ts PERSIST_CACHE_KEY. */
export const PERSISTED_CACHE_KEY = "helpr-rq-cache";
/** window slot: absent while the read is in flight; `{ raw }` once it answered (raw null = nothing stored or no IDB). */
export const PERSISTED_CACHE_EARLY_KEY = "__lhPersistedCacheEarly";

export function startPersistedCacheRead(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[PERSISTED_CACHE_EARLY_KEY] !== undefined || w[`${PERSISTED_CACHE_EARLY_KEY}Started`]) return;
  w[`${PERSISTED_CACHE_EARLY_KEY}Started`] = true;
  const done = (raw: string | null) => {
    w[PERSISTED_CACHE_EARLY_KEY] = { raw };
  };
  try {
    if (typeof indexedDB === "undefined") return done(null);
    const open = indexedDB.open(KEYVAL_DB);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(KEYVAL_STORE);
    };
    open.onerror = () => done(null);
    open.onblocked = () => done(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const get = db.transaction(KEYVAL_STORE, "readonly").objectStore(KEYVAL_STORE).get(PERSISTED_CACHE_KEY);
        get.onsuccess = () => done(typeof get.result === "string" ? get.result : null);
        get.onerror = () => done(null);
      } catch {
        done(null); // no such store (an odd database): the hydrator reads for itself after mount
      } finally {
        // Closed once the transaction ends, so idb-keyval's own connection is never blocked by this one.
        db.close();
      }
    };
  } catch {
    done(null); // IndexedDB blocked (private mode, sandboxed frame): nothing early, the hydrator decides as before
  }
}
