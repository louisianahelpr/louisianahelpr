import { beginSpeculativePrefetch } from "@/lib/chunkReload";

/**
 * Route prefetch map — call the matching dynamic import on hover/focus
 * to warm up the chunk before the user actually navigates.
 *
 * Keep paths in sync with the lazy imports in src/App.tsx. Unknown paths
 * are silent no-ops.
 */
const prefetchers: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/home/Dashboard"),
  "/profile": () => import("@/pages/profile/Profile"),
  "/post-job": () => import("@/pages/post-job/PostJob"),
  "/my-posts": () => import("@/pages/posts/PostsPage"),
  "/my-jobs": () => import("@/pages/jobs/JobsPage"),
  "/messages": () => import("@/pages/messages/Messages"),
  // /support is its own public page now (it used to redirect into the
  // Profile tab system, so this key pointed at the Profile chunk — which
  // meant hovering the link warmed a chunk the route never renders).
  "/support": () => import("@/pages/info/Support"),

  
  "/login": () => import("@/pages/auth/Login"),
  "/signup": () => import("@/pages/auth/Signup"),
  "/user": () => import("@/pages/user/UserProfile"),
  "/browse": () => import("@/pages/home/DashboardGuest"),

  // THE FOOTER'S OWN DESTINATIONS. Every other nav surface in the app —
  // Navbar, MobileNav, the desktop rail — prefetches what it links to; the
  // footer was the only one that did not, and these were the only linked
  // routes with no entry in this map at all. So a visitor clicking Terms
  // from the footer paid for the Legal chunk cold, at the moment of the tap
  // (owner, 2026-09-11: "terms rules and privact take awhile to load in the
  // footer").
  //
  // Four keys for one chunk, deliberately. `/terms`, `/rules` and `/privacy`
  // are REAL routes now rather than redirects into `/legal?tab=…`, so each is
  // a path a visitor actually navigates to, and the prefix match below would
  // not resolve any of them from a lone `/legal` key. `warmed` is keyed on the
  // matched key rather than the module, so the first of them to be warmed
  // still costs one fetch and the rest resolve from the module cache.
  "/legal": () => import("@/pages/info/Legal"),
  "/terms": () => import("@/pages/info/Legal"),
  "/rules": () => import("@/pages/info/Legal"),
  "/privacy": () => import("@/pages/info/Legal"),
  "/help": () => import("@/pages/info/HelpCenter"),
};

const warmed = new Set<string>();

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
    if (done) return;
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
  signedIn: ["/dashboard", "/messages", "/my-jobs", "/post-job", "/profile"],
} as const;

export function prefetchLikelyNextRoutes(signedIn: boolean, currentPath: string): () => void {
  const list: readonly string[] = signedIn ? LIKELY_NEXT_ROUTES.signedIn : LIKELY_NEXT_ROUTES.guest;
  return prefetchRoutesWhenIdle(list.filter((p) => p !== currentPath));
}

export function prefetchRoute(path: string): void {
  if (!path || warmed.has(path)) return;
  // Match by exact key first, then by prefix (so /user/:id, /admin/* etc still hit the right chunk).
  const key = prefetchers[path]
    ? path
    : Object.keys(prefetchers).find((p) => path.startsWith(p));
  if (!key) return;
  warmed.add(key);
  // Fire-and-forget; swallow errors so a failed prefetch never breaks navigation.
  //
  // The `.catch()` alone did NOT achieve that. It eats the REJECTION, but Vite
  // fires a `vite:preloadError` event on `window` first, and main.tsx's global
  // handler turns that into a full cache-purging recovery reload. So a
  // speculative prefetch cancelled by the user's own navigation — exactly what
  // WebKit does to the old document's in-flight requests — broke the very
  // navigation this comment promised it could not. `beginSpeculativePrefetch`
  // is what makes the promise true: see the block comment on it in
  // lib/chunkReload.ts for the repro and why declining here is safe.
  const settle = beginSpeculativePrefetch();
  prefetchers[key]()
    .catch(() => warmed.delete(key))
    .finally(settle);
}
