/**
 * Per-route Suspense fallback. Rendered while a lazy() route chunk is
 * resolving — see `lazyRoute()` in `src/App.tsx`.
 *
 * History & design intent:
 * - PR #276 replaced an earlier full-app "logo + parchment card" fallback
 *   with an intentionally-empty div, because that older version read as
 *   "the whole app is loading" and covered the persistent shell.
 * - Cowork audit 2026-07-08 flagged the empty-div choice: on slow
 *   networks the chunk takes 3-4s and the user sees a blank body inside
 *   a valid shell. Each page's OWN skeleton (Dashboard/Activity/Messages
 *   from PR #274) only fires after the chunk resolves — it cannot cover
 *   the download period.
 *
 * Current compromise: a lightweight content-shaped scaffold — no logo,
 * no full-surface parchment fill, no centered brand card. Just a title-
 * bar bone and a couple of card-shaped bones aligned to the route's
 * standard body column, with animate-pulse. It reads as "the content is
 * arriving" without re-triggering the "whole app is loading" regression.
 *
 * Accessibility:
 * - `aria-busy` + `aria-live="polite"` so screen readers announce the
 *   transition without interrupting the user mid-action.
 * - Decorative bones are aria-hidden; a `sr-only` "Loading…" label keeps
 *   the announcement accessible without a visible spinner.
 */
export const RouteSuspenseFallback = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="w-full min-h-[60vh] px-4 py-6"
    data-testid="route-suspense-fallback"
  >
    <span className="sr-only">Loading…</span>
    <div
      className="mx-auto max-w-lg lg:max-w-5xl space-y-4 motion-safe:animate-pulse"
      aria-hidden="true"
    >
      <div
        className="h-6 rounded-ds-sm w-2/3"
        style={{ background: "hsl(var(--olivewood) / 0.10)" }}
      />
      <div
        className="h-3 rounded-ds-sm w-1/3"
        style={{ background: "hsl(var(--olivewood) / 0.08)" }}
      />
      <div
        className="h-40 rounded-2xl"
        style={{ background: "hsl(var(--olivewood) / 0.06)" }}
      />
      <div
        className="h-32 rounded-2xl"
        style={{ background: "hsl(var(--olivewood) / 0.06)" }}
      />
    </div>
  </div>
);

export default RouteSuspenseFallback;
