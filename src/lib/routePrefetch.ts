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
