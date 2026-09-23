/**
 * Per-route Suspense fallback. Rendered while a lazy() route chunk is
 * resolving — see `lazyRoute()` in `src/App.tsx`.
 *
 * PLAIN PAGE BACKGROUND, nothing drawn (owner decision 2026-09-23, Q201:
 * "Plain background"). It used to draw generic grey bones (a title bar and
 * two big blocks) that matched almost no page's real layout, so a visitor saw
 * one shape and then a different page: the "skeletons are not even the page
 * shape" report. A chunk wait is usually a split second; the page's own
 * data skeleton (shaped like that page) takes over once the chunk lands.
 *
 * - No fill: the region is transparent so the shell and page ground show.
 * - min-h keeps the footer where the page will be, so nothing jumps.
 * - `aria-busy` + a sr-only "Loading…" still announce the wait.
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
