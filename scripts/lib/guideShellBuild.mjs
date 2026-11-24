/**
 * Build side of the gift guide first screens (src/lib/guideShell.mjs has the runtime side and the why): trims each
 * page's full static render (src/prerender/guidePages.tsx) to its first screen and works out the rules that screen
 * needs from the app sheet plus the page's own <style> blocks (scripts/inline-shell-css.mjs shellCriticalCss).
 */
import { JSDOM } from "jsdom";
import { shellCriticalCss } from "../inline-shell-css.mjs";
import { GUIDE_SHELL_ID, GUIDE_SHELL_SHOW_RULE } from "../../src/lib/guideShell.mjs";

/** How many gifts (or deal lines, or Top 10 cards) each first screen keeps; the rest of the list comes with the app. */
export const FIRST_SCREEN_ITEMS = 8;
/**
 * What counts as one item, in page order: a gift (guides, the landing's Top 10, a deals day's picks), a store code, a
 * store sale, a Small Business Saturday row.
 */
export const ITEM_SELECTOR = "[data-gift-pick],[data-gift-code],[data-gift-sale],[data-gift-sbs-row],[data-gift-deal]";

/** React escapes a <style> child's text in a static render; the browser would read "&gt;" literally. */
function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * One width's first screen: no <style> (returned as css, decoded), no site footer, the list cut after its first
 * FIRST_SCREEN_ITEMS items, and on a phone nothing after the page column (the menu and the disclosures sit below the
 * list there). Every link and photo is kept as the page draws it.
 */
export function trimGuideMarkup(markup, phone) {
  // The <style> blocks come out before parsing: their escaped text is not CSS until decoded.
  const css = [];
  const bare = markup.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, text) => {
    css.push(decodeEntities(text));
    return "";
  });
  const dom = new JSDOM(`<!doctype html><html><body><div id="x">${bare}</div></body></html>`);
  const box = dom.window.document.getElementById("x");
  for (const f of [...box.querySelectorAll("footer")]) f.remove();
  const main = box.querySelector(".gg-main");
  if (!main) throw new Error("guide shell: no .gg-main in the page");
  const items = [...main.querySelectorAll(ITEM_SELECTOR)];
  if (items.length > FIRST_SCREEN_ITEMS) {
    // Everything after the last kept item, at every level up to the page column, goes.
    for (let node = items[FIRST_SCREEN_ITEMS - 1]; node && node !== main; node = node.parentElement) {
      while (node.nextSibling) node.nextSibling.remove();
    }
  }
  if (phone) {
    const layout = main.parentElement;
    for (const el of [...(layout?.children ?? [])]) if (el !== main) el.remove();
  }
  return { html: box.innerHTML, css, items: Math.min(items.length, FIRST_SCREEN_ITEMS) };
}

/** A page's block: both widths' first screens (one when they are the same), keyed by its path. */
export function guideShellBlock(path, phoneMarkup, desktopMarkup) {
  const phone = trimGuideMarkup(phoneMarkup, true);
  const desktop = trimGuideMarkup(desktopMarkup, false);
  const v = (name, html) => `<div data-lh-guide-v="${name}">${html}</div>`;
  const inner = phone.html === desktop.html ? v("all", phone.html) : v("phone", phone.html) + v("desktop", desktop.html);
  return {
    block: `<div id="${GUIDE_SHELL_ID}" data-guide-shell="${path}">${inner}</div>`,
    html: phone.html + desktop.html,
    css: [...new Set([...phone.css, ...desktop.css])],
    items: Math.min(phone.items, desktop.items),
  };
}

/**
 * Every page's block and ONE rule set for all of them (a rule is kept when it matches something in any guide's first
 * screen), plus the show rule. `appCss` is the built app sheet; with none, css is null and api/share.ts draws nothing.
 */
export function guideShellData(rendered, appCss) {
  const pages = {};
  const counts = {};
  const htmls = [];
  const pageCss = new Set();
  for (const [path, { phone, desktop }] of Object.entries(rendered)) {
    const b = guideShellBlock(path, phone, desktop);
    pages[path] = b.block;
    counts[path] = b.items;
    htmls.push(b.html);
    // Block by block: every page carries the same guide sheet, and some add their own (the deals days, search).
    for (const c of b.css) pageCss.add(c);
  }
  const css = typeof appCss === "string" && appCss.length
    ? shellCriticalCss([{ html: htmls.join(""), htmlAttr: "" }], `${appCss}\n${[...pageCss].join("\n")}`) + GUIDE_SHELL_SHOW_RULE
    : null;
  return { data: { css, pages }, counts };
}
