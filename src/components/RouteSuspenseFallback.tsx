/**
 * Per-route Suspense fallback. Rendered while a lazy() route chunk is
 * resolving — see `lazyRoute()` in `src/App.tsx`.
 *
 * Design intent (TestFlight feedback after PR #276):
 * The earlier branded card — centered logo + skeleton bars on a parchment
 * fill — read as "the whole app is loading" because it painted a full
 * surface over the route slot. Replaced with a structural placeholder:
 * the persistent shell (header, mobile nav, page card frame) stays
 * visible during the route swap, and each page's own loading branch
 * (Dashboard/Activity/Messages use card-shaped skeletons from PR #274)
 * communicates progress with content-shaped affordances instead.
 *
 * Stay minimal: no logo, no centered loading frame, no background fill.
 * The shell behind us already provides the visual surface.
 *
 * Accessibility:
 * - `aria-busy` + `aria-live="polite"` so screen readers announce the
 *   transition without interrupting the user mid-action.
 * - Visually empty; a `sr-only` "Loading…" label keeps the announcement
 *   accessible without painting a visible spinner or caption.
 */
export const RouteSuspenseFallback = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="w-full min-h-[60vh]"
    data-testid="route-suspense-fallback"
  >
    <span className="sr-only">Loading…</span>
  </div>
);

export default RouteSuspenseFallback;
