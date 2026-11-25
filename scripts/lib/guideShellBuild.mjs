/**
 * Build side of the gift guide first screens (src/lib/guideShell.mjs has the runtime side and the why): trims each
 * page's full static render (src/prerender/guidePages.tsx) to its first screen and works out the rules that screen
 * needs from the app sheet plus the page's own <style> blocks (scripts/inline-shell-css.mjs shellCriticalCss).
 */
import { JSDOM } from "jsdom";
import postcss from "postcss";
import { shellCriticalCss } from "../inline-shell-css.mjs";
import { GUIDE_SHELL_ID, GUIDE_SHELL_SHOW_RULE, guideShellHintRules } from "../../src/lib/guideShell.mjs";

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
  // A signed-in visitor's page has no site bar: PublicLayout draws the guide's container in the app's frame instead of
  // under the guest Navbar and its spacer. Everything beside the container's line of parents is marked, and the
  // member rules (src/lib/guideShell.mjs) hide it, so one drawing serves both.
  const container = box.querySelector("[data-public-container]");
  if (!container) throw new Error("guide shell: no [data-public-container] in the page");
  for (let node = container; node && node !== box; node = node.parentElement) {
    for (const sib of [...(node.parentElement?.children ?? [])]) if (sib !== node) sib.setAttribute("data-lh-guest-only", "");
  }
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
  const html = box.innerHTML;
  // A theme page renders all of its 140-290 gifts before the cut; an unclosed window keeps that whole document alive,
  // and 40 of them ran the build out of heap (11-25, after the theme data trains).
  dom.window.close();
  return { html, css, items: Math.min(items.length, FIRST_SCREEN_ITEMS) };
}

/**
 * The page's own image imports point at Vite's source paths in a build-time render ("/src/assets/helpr-logo-256.webp");
 * the built app serves them hashed ("/assets/helpr-logo-256-7lzBG8jC.webp"). `assetNames` is dist/assets' file list.
 * A source path with no built file is an error: the shell would draw a broken image.
 */
export function builtAssetPaths(html, assetNames) {
  return html.replace(/\/src\/assets\/([\w.-]+?)\.(webp|png|jpe?g|svg|avif|gif)\b/g, (whole, base, ext) => {
    const hit = assetNames.find((n) => n.startsWith(`${base}-`) && n.endsWith(`.${ext}`) && /^[\w-]{8}$/.test(n.slice(base.length + 1, -ext.length - 1)));
    if (!hit) throw new Error(`guide shell: no built file for ${whole} in dist/assets`);
    return `/assets/${hit}`;
  });
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
 * The app sheet's @font-face rules for the families only the page's own rules name (Bodoni Moda: every guide banner).
 * shellCriticalCss keeps the faces of the families the rules it is given name; the page's rules are judged apart from
 * the sheet's, so their faces are added here.
 */
function pageFaces(appCss, ownCss) {
  const fam = (v) => v.trim().replace(/^["']|["']$/g, "").toLowerCase();
  const named = new Set();
  for (const m of ownCss.matchAll(/font-family:([^;}]+)/g)) for (const f of m[1].split(",")) named.add(fam(f));
  return (appCss.match(/@font-face\{[^}]*\}/g) ?? []).filter((r) => named.has(fam(/font-family:([^;}]+)/.exec(r)?.[1] ?? ""))).join("");
}

/** A selector's text with everything inside (), [] and quotes blanked: what remains must all match the element. */
function topLevel(sel) {
  let out = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "\\") {
      out += depth || quote ? "  " : c + (sel[i + 1] ?? "");
      i++;
    } else if (quote) {
      if (c === quote) quote = "";
      out += " ";
    } else if (c === '"' || c === "'") {
      quote = c;
      out += " ";
    } else if (c === "(" || c === "[") {
      depth++;
      out += " ";
    } else if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      out += " ";
    } else out += depth ? " " : c;
  }
  return out;
}

/** A CSS identifier's escapes undone: ".md\\:flex" names the class "md:flex", ".\\31 0" the class "10". */
function unescapeIdent(id) {
  return id.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
}

/**
 * The app sheet less every selector that names, outside any (), [] or quotes, a class no first screen has: such a
 * selector cannot match, so shellCriticalCss would drop it anyway, and its output is the same. It is a speed and memory
 * step only. jsdom took ~16 ms and ~0.45 MB per selector against the 19 pages' first screens (3,514 selectors: 58 s and
 * 1.6 GB, which ran the build out of heap on 11-25 once the theme guides had 140-290 gifts each).
 */
export function withoutAbsentClasses(css, html) {
  const present = new Set();
  const decode = (v) => v.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of decode(m[1]).split(/\s+/)) if (c) present.add(c);
  const possible = (sel) => {
    for (const m of topLevel(sel).matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[\w-]|[^\x00-\x7F])+)/g)) {
      if (!present.has(unescapeIdent(m[1]))) return false;
    }
    return true;
  };
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const keep = rule.selectors.filter(possible);
    if (keep.length === 0) rule.remove();
    else if (keep.length !== rule.selectors.length) rule.selectors = keep;
  });
  return root.toString();
}

/**
 * Every page's block and the rules its first screen needs (a rule is kept when it matches something in any guide's
 * first screen). Two sets, in the order the page itself has them: the app sheet's rules go into the head's inlined
 * block (css, with the show rule), and the page's own <style> rules go INSIDE each block, first. The page draws its
 * <style> in the body, after the app sheet's <link>, so on an equal selector the page's rule wins ("Biggest store
 * sales" is .gg-sec-toggle over the Button's .text-ds-16 and .justify-center); in the head they lost to the sheet once it
 * arrived, and the headings were drawn 1px larger and centred. `appCss` is the built app sheet; with none, css is null
 * and api/share.ts draws nothing.
 */
export function guideShellData(rendered, appCss, assetNames = null) {
  const blocks = {};
  const counts = {};
  const htmls = [];
  const pageCss = new Set();
  for (const [path, { phone, desktop }] of Object.entries(rendered)) {
    const b = guideShellBlock(path, phone, desktop);
    blocks[path] = assetNames ? builtAssetPaths(b.block, assetNames) : b.block;
    counts[path] = b.items;
    htmls.push(b.html);
    // Block by block: every page carries the same guide sheet, and some add their own (the deals days, search).
    for (const c of b.css) pageCss.add(c);
  }
  const used = [{ html: htmls.join(""), htmlAttr: "" }];
  const ownCss = shellCriticalCss(used, withoutAbsentClasses([...pageCss].join("\n"), used[0].html));
  const open = `<div id="${GUIDE_SHELL_ID}"`;
  const pages = Object.fromEntries(
    Object.entries(blocks).map(([path, block]) => {
      const at = block.indexOf(">", block.indexOf(open)) + 1;
      return [path, `${block.slice(0, at)}<style>${ownCss}</style>${block.slice(at)}`];
    }),
  );
  // The faces stay font-display swap: a banner first painted in the fallback face is a smaller box than the app's copy
  // drawn later in the real face, so index.html's guide script redraws the block once each web font is in (new nodes,
  // painted at their real size). font-display block was measured worse (11-24, Slow 4G + 4x, 2 runs: the text stayed
  // blank until the Bodoni file arrived, Monster Jam 3.8 s, Black Friday 4.8 s).
  const css = typeof appCss === "string" && appCss.length
    ? shellCriticalCss(used, withoutAbsentClasses(appCss, used[0].html)) + pageFaces(appCss, ownCss) + GUIDE_SHELL_SHOW_RULE + guideShellHintRules(htmls.join(""))
    : null;
  return { data: { css, pages }, counts };
}
