/**
 * Is there an in-app history entry behind this one?
 *
 * `BackButton` worked this out the hard way and carries the full reasoning: it
 * is NOT `window.history.length` (that counts the whole tab, including pages
 * visited before the app was opened, so it is true even on a cold deep-link)
 * and it is NOT `location.key` (a REPLACE navigation mints a fresh key without
 * adding an entry, so any redirect-on-mount defeats it). react-router stamps an
 * `idx` — its own 0-based position — into `window.history.state`, and a replace
 * deliberately leaves the index put. `idx > 0` is therefore the exact question.
 *
 * It lived as a closure inside BackButton, so the two OTHER ways to go back
 * never got it: the edge-swipe gesture in `PageTransition` and the "Go back"
 * pill on a profile that does not exist. Both ran a bare `navigate(-1)`, which
 * on a cold-opened deep link walks the user out of the app — observed landing
 * on about:blank, or doing nothing at all in a fresh tab. Same bug, same fix,
 * so it is one function now and every back affordance asks it.
 *
 * `fallbackKey` covers the non-browser histories (MemoryRouter, SSR) where
 * `history.state` has no idx: pass `location.key` and it degrades to the old
 * heuristic rather than reporting "no history" for every route.
 */
export function hasInAppHistory(fallbackKey?: string): boolean {
  if (typeof window !== "undefined") {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number") return idx > 0;
  }
  return fallbackKey !== undefined ? fallbackKey !== "default" : false;
}
