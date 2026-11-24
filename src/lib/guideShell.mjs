/**
 * The gift guide first screens in the raw HTML (guide prerender lane, 2026-11-24; owner rule: pages under 2 s).
 *
 * scripts/prerender-static-pages.mjs renders each guide page with its own component (src/prerender/guidePages.tsx),
 * trims it to its first screen (scripts/lib/guideShellBuild.mjs) and writes scripts/generated/guide-shells.js:
 * { css, pages: { "/gift-guides/her": "<div id=\"lh-guide-shell\" ...>...</div>", ... } }. api/share.ts puts a page's
 * block first INSIDE #boot-loader (as /browse's cards, src/lib/browseShellCards.mjs: the boot watchdog's failure screen
 * replaces #boot-loader's insides, so it never sits under the guide) and its rules into the page's inlined
 * <style id="lh-shell-css"> (none of the other HTML-drawn screens is drawn on a guide path; the app sheet still loads
 * after it and repeats every rule). src/boot/guideShellHandoff.ts moves it out of #boot-loader before React's first
 * commit and removes it once the page's own list is on screen. The native app loads dist/index.html itself and never
 * meets this function, so it never carries a guide block.
 *
 * Plain links, no script: with JavaScript blocked the first screen is still the guide and every link works.
 * Guard: src/test/guideShells.test.ts.
 */
export const GUIDE_SHELL_ID = "lh-guide-shell";

/**
 * The block's own rules: a fixed, scrolling layer over the booting app, and one width's drawing shown at a time (the
 * page draws a phone's structure below 768px, src/hooks/use-mobile.tsx).
 */
export const GUIDE_SHELL_SHOW_RULE =
  `#${GUIDE_SHELL_ID}{display:block;position:fixed;inset:0;z-index:2147483000;overflow-x:hidden;overflow-y:auto;background:#fff;text-align:left}` +
  `@media (min-width:768px){#${GUIDE_SHELL_ID}>[data-lh-guide-v="phone"]{display:none}}` +
  `@media (max-width:767px){#${GUIDE_SHELL_ID}>[data-lh-guide-v="desktop"]{display:none}}`;

/** "/gift-guides/her/" -> "/gift-guides/her" (the key a page's block is stored under). */
export function guideShellKey(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * The shell document with this path's guide block first inside #boot-loader and its rules in the inlined block.
 * No data for the path, no rules, or no #boot-loader / inlined block: the page exactly as it was.
 */
export function withGuideShell(html, pathname, data) {
  const block = data && data.pages && Object.prototype.hasOwnProperty.call(data.pages, guideShellKey(pathname)) ? data.pages[guideShellKey(pathname)] : null;
  if (!block || typeof data.css !== "string" || !data.css.includes(GUIDE_SHELL_SHOW_RULE)) return html;
  if (!/<div\s+id="boot-loader"[^>]*>/.test(html) || !html.includes('<style id="lh-shell-css">')) return html;
  const page = html.replace(/<div\s+id="boot-loader"[^>]*>/, (open) => `${open}${block}`);
  return page.replace(/<style id="lh-shell-css">[\s\S]*?<\/style>/, () => `<style id="lh-shell-css">${data.css}</style>`);
}
