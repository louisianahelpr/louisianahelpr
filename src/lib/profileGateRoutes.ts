/**
 * Owner request 11-14 (deferred profile): a new member is no longer sent to the full /complete-profile form right
 * after sign-up. The Terms and 18+ boxes are still asked before anyone reaches the app (ProtectedRoute's
 * isConsentComplete, one short step on /complete-profile); every other profile detail is asked only when it is
 * needed, i.e. on these routes, where a member posts, lists, sells, books, quotes or messages someone.
 *
 * Buttons that commit from a browsing page (Apply, Buy, Make an offer) keep the gates they already have: the
 * server refuses any commitment from a member without current Terms (20261108154435), and the ID check runs at
 * post, hire, first payout and first purchase (OWNER-DECISIONS). Nothing here removes either.
 *
 * Zero imports so vitest and ProtectedRoute can share it. Guard: src/test/deferredCompleteProfile.test.tsx.
 */
const COMMITMENT_ROUTE_RE =
  /^\/(?:post-job|declutter\/(?:sell|move|wanted\/new)|shops\/(?:mine|dashboard)|rentals\/listings\/(?:new|[^/]+\/edit)|messages)(?:\/|$)|^\/(?:quotes\/send|book)\//;

/**
 * True when this path is one where the full profile (a name) is needed before the member goes on. One regular
 * expression, not a list and a loop: this module rides every page's first load (ProtectedRoute), and each byte there
 * counts against the critical-path budget (scripts/perf/critical-path-budget.json, 2026-11-14).
 */
export function isCommitmentPath(pathname: string): boolean {
  return COMMITMENT_ROUTE_RE.test(pathname.split(/[?#]/)[0] ?? "");
}
