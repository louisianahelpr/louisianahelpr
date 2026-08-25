// Route constants for the desktop sidebar rail.
// Kept in a zero-dep file so useAppShellViewport can import isDesktopRailRoute
// without pulling the full DesktopSidebarNav component (and its transitive
// lucide + framer-motion deps) onto the initial critical path.

// Routes where the signed-in app chrome (and therefore the rail) should show.
// NOTE: /jobs is deliberately absent — it's the PUBLIC guest browse page
// (rendered inside PublicLayout with the marketing Navbar + Footer), so the
// authed left rail must not cover it. Its authed counterpart is /dashboard.
export const AUTH_PREFIXES = [
  // Admin. Removing it from NO_NAV_PREFIXES only stopped the nav being
  // suppressed — `isDesktopRailRoute` is an ALLOW-list, so it also has to be
  // named here or the nav still never renders. Both halves are required; this
  // is the pair that actually turns it on.
  "/admin",
  "/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile",
  "/messages", "/schedule", "/availability", "/user", "/earnings",
  "/browse", "/saved-helpers",
  // Strictly-authed (ProtectedRoute) app pages with no public sibling that
  // shares their prefix. They belong to the signed-in app chrome, so the
  // desktop left rail must own their navigation too — otherwise the page
  // renders with no rail and the #root inset never applies, floating the
  // content full-bleed instead of to the right of the rail. NOTE: /family is
  // deliberately excluded — its public /family/accept/:token invite sub-route
  // shares the prefix and would surface the authed rail to logged-out invitees.
  "/gift-card", "/str-settings", "/home-history", "/work-record",
  "/benefits", "/pets",
  // /auto-tip was the one strictly-authed settings page missing from this
  // list — the 2026-08-24 visual audit caught it rendering with no rail and
  // no top bar at desktop widths (the exact failure mode the comment above
  // describes), while every sibling linked from the same profile rows has it.
  "/auto-tip",
  // /wrapped — same failure mode as /auto-tip above: strictly-authed
  // document-scroll page linked from the app, but absent here meant it
  // rendered with no rail and no top bar (caught by the 2026-08-24 B-lane
  // overnight audit at 1440).
  "/wrapped",
  // /data-rights is NOT a page any more — since 2026-08-18 it is a
  // <Navigate> into /profile?tab=legal. It stays listed for the same reason
  // /schedule, /availability and /saved-helpers do (they are also redirects
  // into Profile tabs): <Navigate> still costs one render at the OLD
  // pathname, and if that pathname doesn't match here the rail — and the
  // #root inset keyed off it — flicker off for a frame before /profile
  // turns them back on.
  "/data-rights",
  // /family DOES get the authed desktop rail so wayfinding persists from
  // /dashboard → /family instead of dropping the rail entirely. The
  // public invite sub-route /family/accept/:token must still surface the
  // marketing nav (logged-out invitees), so it's carved out below via
  // AUTH_PREFIX_EXCLUSIONS.
  "/family",
  // NOTE: /subscription is deliberately NOT in this list — it's a
  // marketing page (like /for-business, /help, /legal), rendered inside
  // PublicLayout with the marketing Navbar + Footer + editorial hero.
  // Adding it here surfaces the authed desktop rail alongside the
  // marketing content for signed-in users, which reads as two navigation
  // systems stacked and clashes with the editorial layout. Signed-in
  // users on /subscription keep the marketing Navbar the same way
  // signed-in users on /for-business or /help do.
  //
  // NOTE: /support was REMOVED from this list for exactly that reason. It
  // was here when the route was a redirect into /profile?tab=support (a real
  // authed app page). It now renders src/pages/Support.tsx inside
  // PublicLayout and is reachable LOGGED OUT, so it belongs with /help and
  // /subscription: marketing Navbar, no rail, no #root rail inset. Left in,
  // a signed-in desktop visitor got the authed rail stacked against a
  // marketing footer, plus PublicLayout's nav spacer sitting under a Navbar
  // that had stepped aside — an empty band at the top of the page.
];

// Path prefixes that MUST NOT get the rail even though they'd otherwise
// match an AUTH_PREFIXES entry. Currently just /family/accept — a public
// invite acceptance flow that logged-out visitors can hit; showing them
// the authed rail would be a wayfinding lie.
export const AUTH_PREFIX_EXCLUSIONS = ["/family/accept"];

// `/admin` is NOT here any more. It was, back when the admin console rendered
// its own top bar and its own left rail — a self-contained shell that did not
// want the app's chrome on top of it. Both of those are gone: Admin now lives
// as a section in the shared side panel, and its top bar is phone-only. The
// result was a desktop admin screen with NO top bar at all and therefore no way
// out of it (owner: "if i click on something in admin panel there is no way
// back — top nav should always be there on webpage").
//
// The auth screens stay: those are deliberately focused flows with nothing to
// navigate to, which is a different situation from a console you need to leave.
export const NO_NAV_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password"];

/**
 * True when the desktop sidebar rail owns navigation for `pathname` — i.e. a
 * route the rail covers and isn't explicitly excluded. The marketing Navbar
 * uses this to step aside on those routes so the two navs never stack.
 */
export function isDesktopRailRoute(pathname: string) {
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (AUTH_PREFIX_EXCLUSIONS.some((p) => pathname.startsWith(p))) return false;
  return AUTH_PREFIXES.some((p) => pathname.startsWith(p));
}
