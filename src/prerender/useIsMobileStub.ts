/**
 * The build-time stand-in for src/hooks/use-mobile.tsx while scripts/prerender-static-pages.mjs renders the gift guide
 * first screens (src/prerender/guidePages.tsx): the real hook reads window in an effect, which never runs in a static
 * render, so a page would always render its desktop structure. The prerender renders each guide twice, once per width,
 * and sets which one here. Aliased in only by that script's Vite config; the app never imports this file.
 */
let phone = false;
export function setPrerenderPhone(v: boolean): void {
  phone = v;
}
export function useIsMobile(): boolean {
  return phone;
}
