import { backgroundImport } from "@/lib/chunkReload";
import { isConstrainedNetwork, whenPageSettled } from "@/lib/pageSettled";

// Re-exported for the callers that also prefetch. Boot code (App.tsx, SessionManager) imports them from
// pageSettled.ts itself.
export { isConstrainedNetwork, whenPageSettled };

/**
 * Route prefetch — warm a page's chunk on hover/focus/idle, before the user
 * actually navigates. The table of pages lives in routePrefetchTable.ts and
 * loads on the first warm-up; unknown paths are silent no-ops there.
 */
/** The Posted / Working lists' chunk (JobsSection loads it lazily; Browse warms it). Matched only exactly. */
export const JOB_LISTS_PREFETCH_KEY = "/jobs?lists";

/**
 * Warm a set of route chunks once the browser goes idle.
 *
 * `prefetchRoute` was only ever reachable from hover / focus / touchstart on a
 * nav tab. On a phone touchstart fires a handful of milliseconds before the
 * tap, so in practice the chunk graph was still fetched COLD on navigation —
 * and it is not one request. Measured on the Messages route (production build,
 * mocked backend, 375px): the tap loads `Messages.js`, which pulls twelve child
 * chunks, which pull two more — three dependent levels deep, all in front of
 * the first inbox query. At 0ms asset latency that stretch costs ~120ms; adding
 * a realistic 100ms per-asset latency moved time-to-first-conversation-row from
 * 584ms to 957ms, so the waterfall alone was +373ms (≈3.7 serial round trips).
 *
 * Warming the tabs while the user is reading the page they are already on takes
 * that entire stretch out of every subsequent tab switch. It is deliberately
 * idle-scheduled so it never competes with the current route's own chunks or
 * data, and `prefetchRoute`'s `warmed` set keeps each chunk to one fetch.
 *
 * Returns a cancel function for the unmount path.
 */
export function prefetchRoutesWhenIdle(paths: string[]): () => void {
  if (typeof window === "undefined") return () => {};
  // Q178: a visitor who asked the browser to save data, or who is on a 2G-class
  // link, pays for every speculative byte and gains least from it.
  if (isConstrainedNetwork()) return () => {};
  const run = () => {
    for (const p of paths) prefetchRoute(p);
  };
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let cancel = () => {};
  const schedule = () => {
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      cancel = () => w.cancelIdleCallback?.(id);
      return;
    }
    // Safari / WKWebView has no requestIdleCallback — a plain timer is the
    // fallback, held back far enough that the current route has settled.
    const t = window.setTimeout(run, 1500);
    cancel = () => window.clearTimeout(t);
  };
  // Q178: never while the CURRENT page is still loading (see whenPageSettled).
  const stopWaiting = whenPageSettled(schedule);
  return () => {
    stopWaiting();
    cancel();
  };
}

/**
 * Where a visitor most likely goes next (Q178, owner 2026-09-23: "make sure
 * everything is loading as fast as possible"). Warmed once the page they
 * landed on has loaded (src/entry.ts), so the first tap to any of these finds
 * its chunk already in memory. The signed-in list is the dock's tabs plus the
 * post-job FAB; MobileNav warms the same set whenever the dock is shown, and
 * this covers pages without a dock. `prefetchRoute`'s `warmed` set keeps each
 * to one fetch whichever caller gets there first.
 */
export const LIKELY_NEXT_ROUTES = {
  guest: ["/browse", "/login", "/signup"],
  signedIn: ["/home", "/messages", "/jobs", "/post-job", "/profile"],
} as const;

export function prefetchLikelyNextRoutes(signedIn: boolean, currentPath: string): () => void {
  const list: readonly string[] = signedIn ? LIKELY_NEXT_ROUTES.signedIn : LIKELY_NEXT_ROUTES.guest;
  return prefetchRoutesWhenIdle(list.filter((p) => p !== currentPath));
}

export function prefetchRoute(path: string): void {
  if (!path) return;
  // The table loads on the first warm-up (Builder 2, 11-15): its one preload list per page made this module 6.7 KB
  // minified, and every page's boot carried it (App.tsx and the dock import this file). main.tsx starts it once the
  // page has loaded, so a hover after that finds it in memory. backgroundImport marks the load speculative: a
  // failed fetch of it never starts the chunk recovery reload (see lib/chunkReload.ts).
  void backgroundImport(() => import("@/lib/routePrefetchTable"), "route-prefetch-table")
    .then((m) => m?.warmRoute(path))
    .catch(() => {
      /* speculative: the real navigation loads its own chunk */
    });
}
