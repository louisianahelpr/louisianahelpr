/**
 * Cold-load page starts keyed by PATTERN (guide speed 1124, speed-1122n S1-S3), beside App.tsx's exact-path
 * COLD_ROUTE_PAGES. The gift guides (every slug is one page) and the Holiday Hub already start their chunk beside the
 * app (routePreload.ts PATH_PAGE_PATH, pathPageRoute.ts), but App.tsx asked lazy() for it only at the first render, so
 * the route drew its blank fallback first and the page came in as a held retry. App.tsx calls preloadColdPatternPage as
 * it runs, so lazyWithPreload draws the page as itself. Measured in ~/.lh-shots/guide-speed-1124.
 * Imports nothing: App.tsx passes its own lazy pages in. Guard: src/boot/routePreload.publicPages.test.ts.
 */

/** Every gift guide page GiftGuides draws; the fun pages and printables are their own chunks. */
export const COLD_GUIDE_PAGE = /^\/gift-guides(?:\/(?!(?:draw-names|swipe|planner|printables)\/?$)[^/]+)?\/?$/;
/** The Holiday Hub (not its hire page or the legacy redirects). */
export const COLD_HUB_PAGE = /^\/holidays\/?$/;

/** Start the first row's page whose pattern matches this load's path (none on the server or for other paths). */
export function preloadColdPatternPage(
  rows: ReadonlyArray<readonly [RegExp, { preload: () => void }]>,
  pathname: string | undefined = typeof window === "undefined" ? undefined : window.location.pathname,
): void {
  if (pathname === undefined) return;
  rows.find(([re]) => re.test(pathname))?.[1].preload();
}
