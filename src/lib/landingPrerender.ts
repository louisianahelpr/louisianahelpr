/**
 * The landing page's build-time first paint (Q652). On the web build,
 * dist/index.html carries the signed-out landing page as static HTML in
 * `#landing-prerender`, a sibling BEFORE `#root` (scripts/prerender-landing.mjs),
 * so `/` paints its hero before any JavaScript runs.
 *
 * React renders into `#root` as always. The static copy is removed the moment
 * React's own landing page is in the DOM (Index, in a layout effect, so before
 * that frame paints): the two are the same components, so the swap is
 * invisible. A visitor with a persisted session, or on any route but "/" (a
 * local preview serves dist/index.html for every route), never sees it:
 * index.html's pre-paint script marks <html data-skip-landing>, CSS hides the
 * copy, and main.tsx removes it before React runs, so its ids never linger.
 */
export const LANDING_PRERENDER_ID = "landing-prerender";

export function removeLandingPrerender(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  const el = doc?.getElementById(LANDING_PRERENDER_ID);
  if (!el) return false;
  el.remove();
  return true;
}
