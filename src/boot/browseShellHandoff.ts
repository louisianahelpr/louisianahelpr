/**
 * The hand-off of /browse's server-drawn job cards (PERF-SHELL, Q652) into the app.
 *
 * api/share.ts puts an overlay (#lh-browse-shell, src/lib/browseShellCards.mjs) first inside #boot-loader, so a
 * guest sees real cards at HTML parse instead of after the whole app. React's first commit removes #boot-loader
 * with everything in it, and its first frames on /browse are a blank Suspense fallback, then the skeleton, then
 * the list: so before createRoot, main.tsx calls adoptBrowseShell(), which moves the overlay to <body> where React
 * never touches it, and DashboardGuest removes it once its own list (or empty/error/offline state) is on screen.
 * Removing a fixed overlay is not a layout shift.
 *
 * Kept only for a signed-out visit to /browse (a token holder is redirected to /home: the cards go at once), and
 * never longer than SHELL_MAX_MS, so nothing that goes wrong later can leave it covering the app. The empty-state
 * overlay (no job open) is also dropped when the URL carries a query, whose filtered empty copy differs.
 *
 * Guard: src/test/browseShellHandoff.test.ts.
 */
export const BROWSE_SHELL_ELEMENT_ID = "lh-browse-shell";
/** Upper bound on how long the overlay may cover the booting app. */
export const SHELL_MAX_MS = 10_000;

export function adoptBrowseShell(pathname: string, signedIn: boolean, doc: Document = document, search: string = ""): void {
  const el = doc.getElementById(BROWSE_SHELL_ELEMENT_ID);
  if (!el) return;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  // The empty state (Q2705, data-shell-empty) is the UNFILTERED one: a URL with a query (?cat=, ?q=, ...) gets the
  // app's filtered copy instead, so the HTML's "Nothing today" must not stand in for it.
  const filteredEmpty = el.hasAttribute("data-shell-empty") && search !== "" && search !== "?";
  if (path !== "/browse" || signedIn || filteredEmpty) {
    el.remove();
    return;
  }
  doc.body.appendChild(el);
  setTimeout(() => el.remove(), SHELL_MAX_MS);
}
