/**
 * When the page the visitor is looking at has finished loading, and whether the link is too constrained for
 * speculative bytes (Q178). Split out of routePrefetch.ts (Builder 2, 11-15): App.tsx and SessionManager run
 * whenPageSettled at boot, and importing it from routePrefetch put that module's whole route table (every page's
 * preload list, 6.7 KB minified) in app-shared, the chunk every page boots with. This file imports nothing.
 * src/test/bootSkipsLateHelpers.test.ts keeps it that way.
 */

/**
 * Call `cb` once the page the visitor is looking at has finished loading
 * (Q178): after `load`, AND after the network has gone quiet — no resource
 * (chunk, image, API call) finished for `quietMs`. `load` alone is not enough:
 * measured on a slow phone, `load` fired at ~1.06 s while the landing's chunks
 * and data kept arriving until ~3.4 s, and an idle callback can run in any gap
 * between two responses. A prefetch that starts then takes bandwidth from the
 * page being waited on. Capped at `maxWaitMs` after `load` so a page that
 * polls forever still gets its prefetch eventually.
 */
export function whenPageSettled(cb: () => void, quietMs = 1000, maxWaitMs = 10_000): () => void {
  if (typeof window === "undefined") return () => {};
  let done = false;
  let timer: number | undefined;
  let observer: PerformanceObserver | undefined;
  let lastActivity = performance.now();
  let loadedAt = 0;
  const finish = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    cb();
  };
  const check = () => {
    // A timer can outlive its page (a test environment torn down, a webview gone): no window, nothing to wait for.
    if (done || typeof window === "undefined") return;
    const now = performance.now();
    const quietFor = now - lastActivity;
    if (quietFor >= quietMs || now - loadedAt >= maxWaitMs) finish();
    else timer = window.setTimeout(check, Math.max(100, quietMs - quietFor));
  };
  try {
    observer = new PerformanceObserver(() => {
      lastActivity = performance.now();
    });
    observer.observe({ type: "resource", buffered: false });
  } catch {
    observer = undefined; // no PerformanceObserver: `load` + quietMs alone
  }
  const onLoad = () => {
    loadedAt = performance.now();
    lastActivity = Math.max(lastActivity, loadedAt);
    check();
  };
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad, { once: true });
  return () => {
    done = true;
    observer?.disconnect();
    window.clearTimeout(timer);
    window.removeEventListener("load", onLoad);
  };
}

/**
 * Save-Data on, or a 2G-class effective connection (Network Information API;
 * absent in Safari, where this is false and prefetch proceeds).
 */
export function isConstrainedNetwork(): boolean {
  try {
    const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!c) return false;
    return c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g";
  } catch {
    // A feature probe: an exotic navigator that throws on read just means we
    // cannot tell, and prefetching (the pre-Q178 behaviour) is the default.
    return false;
  }
}
