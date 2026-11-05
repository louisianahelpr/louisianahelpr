#!/usr/bin/env node
/**
 * Q2705 (Slow 4G first frame; lead 11-05: "A+B now"): put the CSS that the HTML-drawn first screen needs INTO
 * dist/index.html, so that screen paints with the HTML instead of waiting on the app stylesheet.
 *
 * index.html's #lh-landing-shell (B100) is the guest landing's top bar and LOCKED hero, drawn by the HTML. Until now it
 * was shown only by the app stylesheet (src/index.css, `[data-lh-landing-shell] #lh-landing-shell`), which loads
 * without blocking (vite.config.ts html-async-entry-css). On Slow 4G that sheet (~40 KB gz) shares the 180 KB/s link
 * with the boot JavaScript, so the shell painted at ~2.1 s live although the HTML is in at ~0.9 s.
 *
 * This step reads the built sheet, keeps only the rules whose selector matches something in the first-frame page (the
 * shell inside the boot document, <html> marked as index.html marks it; :hover/:focus and pseudo-elements read as their
 * element), plus the @font-face of every family those rules name, and writes them, with
 * the shell's show rule, into a <style id="lh-shell-css"> in <head>. They are the app's own compiled rules, in the
 * app's own order, so the shell looks exactly as it did; the full sheet still loads as before and repeats them.
 *
 * Wired into `npm run build` after `vite build` and before build-og-shell.mjs, so api/share.ts serves the same head.
 * Guard: src/test/shellCriticalCss.test.ts.
 *
 *   node scripts/inline-shell-css.mjs            # rewrite dist/index.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { JSDOM } from "jsdom";

export const SHELL_START = '<div id="lh-landing-shell"';
export const SHELL_END = '<span data-lh-shell="end" hidden></span>';
export const STYLE_ID = "lh-shell-css";
/** The show rule that src/index.css also carries; inline it too, or the inlined rules style a hidden block. */
export const SHOW_RULE =
  "[data-lh-landing-shell] #lh-landing-shell{display:block;position:fixed;inset:0;z-index:2147483000;overflow:hidden}";
/** Ceiling on the inlined block, gzip bytes; the build fails above it. Measured 8,113 B on the 2026-11-05 build of c477530839 (+5%). */
export const MAX_INLINE_BYTES = 8_500;

/** Classes, ids and element names the shell markup uses (the test's inventory of what the shell is made of). */
export function shellVocabulary(shellHtml) {
  const classes = new Set();
  for (const m of shellHtml.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(decodeEntities(c));
  const ids = new Set([...shellHtml.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
  const tags = new Set([...shellHtml.matchAll(/<([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  return { classes, ids, tags };
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// A first frame has no hover, focus or press, and a pseudo-element hangs off a real element: match each selector with
// those taken out, so ".x:hover" and ".x::before" are kept exactly when ".x" is on the page.
const PSEUDO_ELEMENT = /::?(?:before|after|placeholder|selection|marker|backdrop|file-selector-button|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+|-ms-[\w-]+)(?![\w-])/g;
const DYNAMIC = /:(?:hover|focus|focus-visible|focus-within|active|visited|target|autofill)(?![\w-])/g;

/**
 * The page at its first frame: the shell inside the boot document, with <html> marked the way index.html's inline
 * scripts mark it for a guest on "/" (data-lh-landing-shell), once per theme.
 */
export function shellDocuments(shellHtml) {
  return ["light", "dark"].map(
    (theme) =>
      new JSDOM(`<!doctype html><html lang="en" data-theme="${theme}" data-lh-landing-shell=""><head></head><body><div id="root"></div>${shellHtml}</div></body></html>`).window.document,
  );
}

/** True when one selector matches something in the first-frame page, in either theme. */
export function selectorNeeded(sel, docs) {
  const base = sel.replace(PSEUDO_ELEMENT, "").replace(DYNAMIC, "").trim().replace(/[>+~]\s*$/, "").trim() || "*";
  for (const doc of docs) {
    try {
      if (doc.querySelector(base)) return true;
    } catch {
      // A selector the DOM engine cannot parse (a vendor pseudo-class): keep it rather than lose a rule the browser applies.
      return true;
    }
  }
  return false;
}

/** The subset of `css` the shell markup needs, in source order. */
export function shellCriticalCss(shellHtml, css) {
  const docs = shellDocuments(shellHtml);
  const root = postcss.parse(css);
  root.walkAtRules((at) => {
    // Animations are not part of a first frame.
    if (/keyframes$/.test(at.name)) at.remove();
  });
  root.walkRules((rule) => {
    const keep = rule.selectors.filter((s) => selectorNeeded(s, docs));
    if (keep.length === 0) rule.remove();
    else rule.selectors = keep;
  });
  // The @font-face of every family a kept rule names stays: without it the hero paints in a fallback face and
  // swaps when the app sheet arrives (measured 11-05 without it: LCP 1972 -> 3408 ms, CLS 0 -> 0.2254, one run).
  // The files are fetched only when the face is used, so unused unicode ranges cost nothing.
  const families = new Set();
  root.walkDecls(/^font-family$/, (d) => {
    if (d.parent?.type === "atrule") return;
    for (const f of d.value.split(",")) families.add(f.trim().replace(/^["']|["']$/g, "").toLowerCase());
  });
  root.walkAtRules("font-face", (at) => {
    let fam = "";
    at.walkDecls("font-family", (d) => { fam = d.value.trim().replace(/^["']|["']$/g, "").toLowerCase(); });
    if (!families.has(fam)) at.remove();
  });
  // Drop at-rules left empty (twice: an @media inside an emptied @supports).
  for (let i = 0; i < 2; i++) root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove(); });
  return root.toString().replace(/\n+/g, "");
}

/** index.html with the shell's critical CSS and show rule in <head>; unchanged when it has no shell. */
export function inlineShellCss(html, css) {
  const a = html.indexOf(SHELL_START);
  const b = html.indexOf(SHELL_END);
  if (a < 0 || b < a) throw new Error("inline-shell-css: index.html has no #lh-landing-shell block");
  if (html.includes(`<style id="${STYLE_ID}">`)) throw new Error("inline-shell-css: already inlined (run once per build)");
  const critical = shellCriticalCss(html.slice(a, b), css);
  const block = `<style id="${STYLE_ID}">${critical}${SHOW_RULE}</style>`;
  const at = html.indexOf("</head>");
  if (at < 0) throw new Error("inline-shell-css: no </head>");
  return { html: html.slice(0, at) + block + html.slice(at), bytes: block.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dist = path.join(root, "dist");
  const indexPath = path.join(dist, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="(\/assets\/[^"]+\.css)"[^>]*data-async-css>/g)].map((m) => m[1]);
  if (hrefs.length === 0) throw new Error("inline-shell-css: no async app stylesheet in dist/index.html");
  const css = hrefs.map((h) => readFileSync(path.join(dist, h), "utf8")).join("\n");
  const { html: out, bytes } = inlineShellCss(html, css);
  const { gzipSync } = await import("node:zlib");
  const gz = gzipSync(out.slice(out.indexOf(`<style id="${STYLE_ID}">`), out.indexOf("</head>"))).length;
  if (gz > MAX_INLINE_BYTES) throw new Error(`inline-shell-css: inlined block is ${gz} B gz, over ${MAX_INLINE_BYTES}`);
  writeFileSync(indexPath, out);
  console.log(`inline-shell-css: ${bytes} B (${gz} B gz) of the app sheet inlined for the HTML-drawn first screen`);
}
