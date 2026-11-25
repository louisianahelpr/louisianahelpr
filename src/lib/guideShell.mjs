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
/**
 * Set on <html> by index.html's guide script before the first paint, from the same stored-session test the app uses
 * (src/lib/persistedAuthToken.ts): a signed-in visitor (member) and the guide tips already closed (hints, space
 * separated GiftHint ids).
 */
export const GUIDE_MEMBER_ATTR = "data-lh-guide-member";
export const GUIDE_HINTS_ATTR = "data-lh-gg-hints";
/** The desktop website's top bar (src/lib/desktopBar.ts DESKTOP_BAR_H) and left rail (index.css --desktop-sidebar-w). */
export const MEMBER_BAR_PX = 70;
export const MEMBER_RAIL_PX = 248;
/** The width the rail and bar appear from (src/hooks/useIsWebDesktop.ts WEB_DESKTOP_QUERY). */
export const MEMBER_DESKTOP_MIN_PX = 900;

/**
 * The block's own rules: a fixed, scrolling layer over the booting app, and one width's drawing shown at a time (the
 * page draws a phone's structure below 768px, src/hooks/use-mobile.tsx). For a member (Finish + land for everyone,
 * owner 2026-11-24 ~10 PM) the guest site bar and its spacer are hidden (PublicLayout draws the same container in the
 * app's frame, with no bar), and from 900px the layer starts below the app's top bar and right of its rail, so both
 * appear beside it as soon as the app draws them and the guide does not move at the hand-off.
 */
export const GUIDE_SHELL_SHOW_RULE =
  `#${GUIDE_SHELL_ID}{display:block;position:fixed;inset:0;z-index:2147483000;overflow-x:hidden;overflow-y:auto;background:#fff;text-align:left}` +
  `@media (min-width:768px){#${GUIDE_SHELL_ID}>[data-lh-guide-v="phone"]{display:none}}` +
  `@media (max-width:767px){#${GUIDE_SHELL_ID}>[data-lh-guide-v="desktop"]{display:none}}` +
  `html[${GUIDE_MEMBER_ATTR}] #${GUIDE_SHELL_ID} [data-lh-guest-only]{display:none}` +
  `@media (min-width:${MEMBER_DESKTOP_MIN_PX}px){html[${GUIDE_MEMBER_ATTR}] #${GUIDE_SHELL_ID}{top:${MEMBER_BAR_PX}px;left:${MEMBER_RAIL_PX}px}}`;

/**
 * The build draws a guide's tips as a first-time visitor sees them (src/prerender/guidePages.tsx); one rule per tip in
 * the drawings hides it again for a visitor who closed it (GUIDE_HINTS_ATTR). The menu tip carries data-gift-menu-hint,
 * every other GiftHint data-gift-hint="<id>".
 */
export function guideShellHintRules(html) {
  const ids = new Set();
  if (html.includes("data-gift-menu-hint=")) ids.add("menu");
  for (const m of html.matchAll(/data-gift-hint="([\w-]+)"/g)) ids.add(m[1]);
  return [...ids]
    .sort()
    .map((id) => `html[${GUIDE_HINTS_ATTR}~="${id}"] #${GUIDE_SHELL_ID} ${id === "menu" ? "[data-gift-menu-hint]" : `[data-gift-hint="${id}"]`}{display:none}`)
    .join("");
}

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
