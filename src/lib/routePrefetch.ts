/**
 * Route prefetch map — call the matching dynamic import on hover/focus
 * to warm up the chunk before the user actually navigates.
 *
 * Keep paths in sync with the lazy imports in src/App.tsx. Unknown paths
 * are silent no-ops.
 */
const prefetchers: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/profile": () => import("@/pages/Profile"),
  "/post-job": () => import("@/pages/PostJob"),
  "/my-posts": () => import("@/pages/Activity"),
  "/my-jobs": () => import("@/pages/Activity"),
  "/messages": () => import("@/pages/Messages"),
  // /support is its own public page now (it used to redirect into the
  // Profile tab system, so this key pointed at the Profile chunk — which
  // meant hovering the link warmed a chunk the route never renders).
  "/support": () => import("@/pages/Support"),
  // /schedule /availability /saved-helpers still redirect into the Profile
  // tab system — prefetch the Profile chunk so the shell is ready when the
  // redirect lands.
  "/schedule": () => import("@/pages/Profile"),
  "/availability": () => import("@/pages/Profile"),
  "/saved-helpers": () => import("@/pages/Profile"),

  "/jobs": () => import("@/pages/Jobs"),
  
  "/login": () => import("@/pages/Login"),
  "/signup": () => import("@/pages/Signup"),
  "/account-pending": () => import("@/pages/AccountPending"),
  "/user": () => import("@/pages/UserProfile"),
  "/activity": () => import("@/pages/Activity"),
  "/earnings": () => import("@/pages/Profile"),
  "/browse": () => import("@/pages/DashboardGuest"),
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
  const run = () => {
    for (const p of paths) prefetchRoute(p);
  };
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(run, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  // Safari / WKWebView has no requestIdleCallback — a plain timer is the
  // fallback, held back far enough that the current route has settled.
  const t = window.setTimeout(run, 1500);
  return () => window.clearTimeout(t);
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
  prefetchers[key]().catch(() => warmed.delete(key));
}
