import { createLazyModule } from "@/lib/lazyModule";

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

/** Start fetching the dock's framer chunk; safe to call any number of times. */
export const startDockMotion = dock.start;
/** The dock's framer module once it has arrived; `null` until then. */
export const useDockMotion = dock.use;
