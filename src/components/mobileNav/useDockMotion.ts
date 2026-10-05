import { useEffect } from "react";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";

/**
 * framer-motion for the bottom dock, fetched AFTER the dock has painted (Q1172).
 *
 * WHY THIS EXISTS. MobileNav used to import NavQuickMenu and SharedLayoutPill
 * statically; both are framer-motion, so the lazy dock chunk could not run
 * until proxy.js (~35 kB brotli) had downloaded: filmstrip of a cold /home at
 * 375, Slow 4G + 4x CPU: title bar and skeleton at 4.4 s, dock at 5.4 s.
 *
 * Neither piece is visible in the dock's first frame. The sliding active pill
 * is drawn by DockPill as the identical plain `<span>` until this module has
 * arrived (a framer pill with no sibling to slide from is that same span), and
 * the long-press quick menu does not exist until a long press. So the dock
 * draws with its page, and this module is fetched once the page has settled,
 * or at once when a long press needs the menu.
 *
 * `scripts/check-deferred-vendors.mjs` requires MobileNav's closure to stay
 * free of framer-motion. Do not turn the import back into a static one.
 */
type DockMotion = typeof import("./dockMotion");

const dock = createLazyModule<DockMotion>(() => import("./dockMotion"), "MobileNav.loadDockMotion");

/** The dock's framer module once it has arrived; `null` until then. */
export const useDockMotion = dock.use;

/**
 * MobileNav's view of the module: starts the fetch, then returns it (null until
 * it has arrived). The fetch starts once the page has settled, but not while the dock is hidden
 * (guests, marketing pages: a visitor who never sees the dock never downloads
 * framer for it), and at once when a long press opens the quick menu.
 */
export function useDockMotionLoader(dockHidden: boolean, menuOpen: boolean): DockMotion | null {
  useEffect(() => {
    if (dockHidden) return;
    return whenPageSettled(dock.start);
  }, [dockHidden]);
  useEffect(() => {
    if (menuOpen) dock.start();
  }, [menuOpen]);
  return dock.use();
}
