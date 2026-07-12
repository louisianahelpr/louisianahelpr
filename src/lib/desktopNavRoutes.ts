// Route constants for the desktop sidebar rail.
// Kept in a zero-dep file so useAppShellViewport can import isDesktopRailRoute
// without pulling the full DesktopSidebarNav component (and its transitive
// lucide + framer-motion deps) onto the initial critical path.

// Routes where the signed-in app chrome (and therefore the rail) should show.
// NOTE: /jobs is deliberately absent — it's the PUBLIC guest browse page
// (rendered inside PublicLayout with the marketing Navbar + Footer), so the
// authed left rail must not cover it. Its authed counterpart is /dashboard.
export const AUTH_PREFIXES = [
  "/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile",
  "/messages", "/support", "/schedule", "/availability", "/user", "/earnings",
  "/browse", "/saved-helpers",
  // Strictly-authed (ProtectedRoute) app pages with no public sibling that
  // shares their prefix. They belong to the signed-in app chrome, so the
  // desktop left rail must own their navigation too — otherwise the page
  // renders with no rail and the #root inset never applies, floating the
  // content full-bleed instead of to the right of the rail. NOTE: /family is
  // deliberately excluded — its public /family/accept/:token invite sub-route
  // shares the prefix and would surface the authed rail to logged-out invitees.
  "/pay-it-forward", "/str-settings", "/home-history", "/work-record",
  "/benefits", "/analytics", "/pets",
  // NOTE: /subscription is deliberately NOT in this list — it's a
  // marketing page (like /for-business, /help, /legal), rendered inside
  // PublicLayout with the marketing Navbar + Footer + editorial hero.
  // Adding it here surfaces the authed desktop rail alongside the
  // marketing content for signed-in users, which reads as two navigation
  // systems stacked and clashes with the editorial layout. Signed-in
  // users on /subscription keep the marketing Navbar the same way
  // signed-in users on /for-business or /help do.
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
