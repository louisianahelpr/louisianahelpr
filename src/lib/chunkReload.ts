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

const RELOAD_FLAG = "helpr_chunk_reload_at";

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
 * Recover from a stale-chunk error: hard-reload at most once per 10s window
 * (session-scoped) so we never loop. Returns true if a reload was kicked
 * off, false if the guard suppressed it (already reloaded recently).
 */
export const recoverFromChunkError = (): boolean => {
  // Same offline guard as hardReloadBypassCache, checked here too so callers
  // get an honest `false` (= "I did not start a reload, show your error UI")
  // rather than a true that promises a recovery which will never arrive.
  // A chunk that failed because the device is offline is not stale, and no
  // amount of reloading will fetch it.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0");
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — fall through */
  }
  if (Date.now() - last <= 10_000) return false;
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* ignore — still attempt the reload */
  }
  void hardReloadBypassCache();
  return true;
};
