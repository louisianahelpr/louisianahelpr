// Route constants for the desktop sidebar rail.
// Kept in a zero-dep file so useAppShellViewport can import isDesktopRailRoute
// without pulling the full DesktopSidebarNav component (and its transitive
// lucide + framer-motion deps) onto the initial critical path.

// Routes where the signed-in app chrome (and therefore the rail) should show.
export const AUTH_PREFIXES = [
  "/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile",
  "/messages", "/support", "/schedule", "/availability", "/user", "/earnings",
  "/jobs", "/browse", "/job-history", "/saved-helpers", "/community",
];

export const NO_NAV_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];

/**
 * True when the desktop sidebar rail owns navigation for `pathname` — i.e. a
 * route the rail covers and isn't explicitly excluded. The marketing Navbar
 * uses this to step aside on those routes so the two navs never stack.
 */
export function isDesktopRailRoute(pathname: string) {
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  return AUTH_PREFIXES.some((p) => pathname.startsWith(p));
}
