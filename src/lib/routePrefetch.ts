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
  "/support": () => import("@/pages/Support"),
  "/schedule": () => import("@/pages/Schedule"),
  "/saved-helpers": () => import("@/pages/SavedHelpers"),
  "/heroes": () => import("@/pages/Heroes"),
  "/jobs": () => import("@/pages/Jobs"),
  "/community": () => import("@/pages/Community"),
  "/login": () => import("@/pages/Login"),
  "/signup": () => import("@/pages/Signup"),
};

const warmed = new Set<string>();

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
