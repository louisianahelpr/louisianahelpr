import { useEffect } from "react";

/**
 * The class on <html> that makes the bottom dock (MobileNav's
 * `.mobile-nav-frame`) step aside: `visibility: hidden` in src/index.css,
 * which takes it out of painting, hit-testing, the tab order and the a11y
 * tree at once.
 */
export const DOCK_YIELD_CLASS = "dock-yield";

// More than one surface may hold the dock aside at a time (a route change can
// mount the next holder before the last one unmounts), so the class comes off
// only when the last holder lets go.
let holders = 0;

/**
 * A fixed bottom action bar that sits flush on the screen edge calls this
 * while it shows, and the dock yields that strip to it (Q1646).
 *
 * Why the dock yields rather than the bar's z-index going up: the bar renders
 * inside <PageTransition>, whose motion.div carries `will-change: transform`
 * and so is its own stacking context. Any z-index on the bar only orders it
 * inside the page; the page as a whole still paints under the dock's z-50.
 * Measured 2026-10-11 (e2e-journeys 38157785191, chromium and webkit at
 * tablet-768): the Edit Profile "Save Changes" button could not be clicked for
 * 20s because the dock's Profile tab took the pointer.
 *
 * Bars that float ABOVE the dock instead read the shared clearance
 * (`bottom-safe-nav` / `var(--bottom-nav-h, 96px)`); src/test/fixedBottomBarsClearTheDock.test.ts
 * requires every fixed bottom bar to do one or the other.
 */
export function useDockYield(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    holders += 1;
    document.documentElement.classList.add(DOCK_YIELD_CLASS);
    return () => {
      holders = Math.max(0, holders - 1);
      if (holders === 0) document.documentElement.classList.remove(DOCK_YIELD_CLASS);
    };
  }, [active]);
}
