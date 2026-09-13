/**
 * Stale-chunk recovery — shared by the error boundaries and the eager
 * `vite:preloadError` handler in `main.tsx`.
 *
 * When a deploy ships new content-hashed chunks, a tab opened against the
 * previous build still references the now-404'd old filenames. The next
 * lazy `import()` throws "Failed to fetch dynamically imported module"
 * (or Vite fires a `vite:preloadError` event before any boundary catches).
 * The only real fix is a hard reload that bypasses the SW/HTTP cache so the
 * browser pulls the fresh chunk manifest. A one-shot session guard keeps us
 * from looping if the reload itself can't recover.
 */

/** True when `err` looks like a stale-chunk / mismatched-React-instance failure. */
export const isChunkLoadError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    // Stale React module after HMR / deploy: the previous render's React
    // dispatcher was unmounted while a lazy chunk finished loading, so any
    // hook call (useContext, useState, etc.) sees a null dispatcher. A
    // hard reload re-binds every module to the same React instance.
    /dispatcher\.use[A-Z]\w*/i.test(msg) ||
    /Cannot read propert(y|ies) of null \(reading 'use[A-Z]\w*'\)/i.test(msg) ||
    /null is not an object \(evaluating '[\w.]*dispatcher/i.test(msg) ||
    // Invalid hook call — same root cause (mismatched React instances).
    /Invalid hook call/i.test(msg)
  );
};

/** Timestamp (ms) of the most recent automatic reload attempt. */
const RELOAD_FLAG = "helpr_chunk_reload_at";
/** Automatic reload attempts spent on the current failure episode. */
const RELOAD_COUNT = "helpr_chunk_reload_count";

/**
 * Hard cap on automatic reloads per failure episode. The first reload can
 * itself land on the OLD build (edge still propagating mid-deploy), so one
 * attempt was not enough; two rides out a propagation window and cannot loop.
 */
export const CHUNK_RELOAD_MAX_ATTEMPTS = 2;
/** Minimum gap between attempt 1 and attempt 2, long enough for a deploy to settle. */
export const CHUNK_RELOAD_BACKOFF_MS = 30_000;
/**
 * An attempt older than this belongs to a previous episode (a later deploy),
 * so the counter starts over. Also the minimum age before a successful chunk
 * load may clear the counter: clearing it at once would let "entry loads,
 * route chunk still 404s" reload forever.
 */
export const CHUNK_RELOAD_EPISODE_MS = 5 * 60_000;

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

const readState = (): { count: number; last: number } => {
  let count = 0;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0") || 0;
    const rawCount = sessionStorage.getItem(RELOAD_COUNT);
    count = Number(rawCount || "0") || 0;
    // A timestamp with no counter (a tab from the previous build, or a test
    // arming the guard the old way) means one attempt is already spent.
    if (last > 0 && rawCount === null) count = Math.max(count, 1);
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — treat as fresh */
  }
  if (last > 0 && Date.now() - last > CHUNK_RELOAD_EPISODE_MS) return { count: 0, last: 0 };
  return { count, last };
};

/**
 * Persist an attempt. Returns false when the counter did not stick: without
 * storage there is no cap across reloads, so no attempt beyond the first may
 * proceed (fail closed, never loop).
 */
const writeAttempt = (count: number): boolean => {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    sessionStorage.setItem(RELOAD_COUNT, String(count));
    return sessionStorage.getItem(RELOAD_COUNT) === String(count);
  } catch {
    // Storage blocked (private mode / WKWebView): caller treats false as "no cap persisted" and fails closed.
    return false;
  }
};

/** True when the current URL carries a `_v` cache-buster set within the episode window. */
const landedFromRecentRecoveryReload = (): boolean => {
  try {
    const v = Number(new URL(window.location.href).searchParams.get("_v") || "0") || 0;
    return v > 0 && Date.now() - v <= CHUNK_RELOAD_EPISODE_MS;
  } catch {
    // Unparseable URL: cannot tell whether this page is a recovery reload, so fail closed.
    return true;
  }
};

let pendingRetry:ReturnType<typeof setTimeout> | null = null;

/**
 * Call when a lazy chunk loaded successfully. Clears the attempt counter, but
 * only once the last attempt is a whole episode old, so a page whose entry
 * loads while its route chunk still 404s keeps its spent attempts.
 */
export const markChunkLoadSucceeded = (): void => {
  try {
    const rawLast = sessionStorage.getItem(RELOAD_FLAG);
    if (rawLast === null && sessionStorage.getItem(RELOAD_COUNT) === null) return;
    if (Date.now() - (Number(rawLast || "0") || 0) < CHUNK_RELOAD_EPISODE_MS) return;
    sessionStorage.removeItem(RELOAD_FLAG);
    sessionStorage.removeItem(RELOAD_COUNT);
  } catch {
    // Storage blocked: there is no counter to clear, so silence is correct.
  }
};

/** Test-only: drop any scheduled retry. */
export const __resetChunkReloadForTests = (): void => {
  if (pendingRetry) clearTimeout(pendingRetry);
  pendingRetry = null;
};

/**
 * Force-reload that purges any cached service-worker / Cache Storage entry
 * before navigating. Required when a chunk load error happens because the
 * SW is serving a stale module map; a plain `location.reload()` would just
 * hand back the same stale page.
 */
export const hardReloadBypassCache = async () => {
  // OFFLINE GUARD — do not run the destructive recovery when there is no
  // network. This function unregisters every service worker and deletes every
  // Cache Storage entry, which is correct for a stale deploy and catastrophic
  // when the user is simply offline: it destroys the precache (including
  // offline.html) and the html-pages cache, i.e. the app's entire ability to
  // work without a network. The following navigation then has no service
  // worker AND no server, so the user gets the browser's own error page.
  //
  // This is not hypothetical — it is why offline.html never appeared. Offline,
  // a lazy route chunk fails with "Failed to fetch dynamically imported
  // module", which isChunkLoadError matches first, so an offline navigation
  // was self-destructing on every attempt (verified 2026-08-10 against a built
  // dist with the server stopped).
  //
  // Offline is not recoverable by reloading, so the honest response is to do
  // nothing here and let the caller fall through to its normal error UI —
  // which is the in-app offline state, or offline.html on a cold navigation.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => null)));
    }
  } catch {
    /* swallow — proceed to caches + reload */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => null)));
    }
  } catch {
    /* swallow — proceed to reload */
  }
  // Add a cache-buster query param so the browser fetches fresh HTML
  // instead of serving the cached response.
  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(Date.now()));
  window.location.replace(url.toString());
};

/**
 * Recover from a stale-chunk error with a bounded retry:
 *   attempt 1: immediately;
 *   attempt 2: no sooner than CHUNK_RELOAD_BACKOFF_MS after attempt 1, because
 *              the first reload can land on the old build mid-deploy;
 *   then none. The cap is a sessionStorage counter, so it holds across the
 *   reloads themselves and can never loop.
 *
 * Returns true only when a reload is starting NOW (the caller may show a quiet
 * "updating" state). While attempt 2 waits on its backoff it returns false, so
 * the caller shows its honest error card, and the retry fires on a timer.
 */
export const recoverFromChunkError = (): boolean => {
  // Same offline guard as hardReloadBypassCache, checked here too so callers
  // get an honest `false` (= "I did not start a reload, show your error UI")
  // rather than a true that promises a recovery which will never arrive.
  // A chunk that failed because the device is offline is not stale, and no
  // amount of reloading will fetch it.
  if (isOffline()) return false;
  const { count, last } = readState();
  if (count >= CHUNK_RELOAD_MAX_ATTEMPTS) {
    // Still failing after the cap: keep the episode alive, so a page that
    // errors steadily never ages out into a fresh pair of reloads.
    try {
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    } catch {
      /* no storage: nothing to extend, and nothing reloads either */
    }
    return false;
  }

  const wait = count === 0 ? 0 : CHUNK_RELOAD_BACKOFF_MS - (Date.now() - last);
  if (wait <= 0) {
    // Without working storage the counter reads 0 on every load, so the only
    // marker that survives the reload is our own `_v` cache-buster. Attempt 1
    // proceeds only if this page is not itself a recent recovery reload; any
    // later attempt requires the counter to have persisted.
    if (!writeAttempt(count + 1)) {
      if (count > 0 || landedFromRecentRecoveryReload()) return false;
    }
    void hardReloadBypassCache();
    return true;
  }

  if (!pendingRetry) {
    pendingRetry = setTimeout(() => {
      pendingRetry = null;
      // Re-check everything at fire time: the device may have gone offline,
      // or another tab/boundary may have spent the attempt meanwhile.
      if (isOffline()) return;
      const current = readState();
      if (current.count >= CHUNK_RELOAD_MAX_ATTEMPTS) return;
      if (!writeAttempt(current.count + 1)) return;
      void hardReloadBypassCache();
    }, wait);
  }
  return false;
};
