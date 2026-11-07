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
import { GREETING_SHELL_MARKUP } from "../src/lib/homeGreetingShell.mjs";

export const SHELL_START = '<div id="lh-landing-shell"';
export const SHELL_END = '<span data-lh-shell="end" hidden></span>';
export const STYLE_ID = "lh-shell-css";
const FIXED = "{display:block;position:fixed;inset:0;z-index:2147483000;overflow:hidden}";
/** The show rule that src/index.css also carries; inline it too, or the inlined rules style a hidden block. */
export const SHOW_RULE = `[data-lh-landing-shell] #lh-landing-shell${FIXED}`;
/**
 * Every HTML-drawn first screen in index.html (Q2705 A): its block id, the attribute index.html's inline scripts set
 * on <html> when it is shown, and its show rule (src/index.css carries the same rules). The landing comes first and
 * must be there; the /login and /signup shells (src/test/authShellsMatchPages.test.tsx) are read when present.
 */
export const SHELLS = [
  { id: "lh-landing-shell", htmlAttr: 'data-lh-landing-shell=""', show: SHOW_RULE },
  { id: "lh-login-shell", htmlAttr: 'data-lh-auth-shell="login"', show: `[data-lh-auth-shell="login"] #lh-login-shell${FIXED}` },
  { id: "lh-signup-shell", htmlAttr: 'data-lh-auth-shell="signup"', show: `[data-lh-auth-shell="signup"] #lh-signup-shell${FIXED}` },
  // Q2705 B: a signed-in phone's /home (src/test/homeShellMatchesSkeleton.test.tsx).
  // Its greeting slot is filled by index.html's inline script (Q1158), so the drawn h1 and date line count as markup.
  { id: "lh-home-shell", htmlAttr: 'data-lh-app-shell="home"', show: `[data-lh-app-shell="home"] #lh-home-shell${FIXED}`, extra: GREETING_SHELL_MARKUP },
  // Q2705 B: and its /jobs (src/test/jobsShellMatchesSkeleton.test.tsx).
  { id: "lh-jobs-shell", htmlAttr: 'data-lh-app-shell="jobs"', show: `[data-lh-app-shell="jobs"] #lh-jobs-shell${FIXED}` },
  // Q2705 B: its /messages and /declutter (src/test/messagesDeclutterShellsMatchSkeletons.test.tsx).
  { id: "lh-messages-shell", htmlAttr: 'data-lh-app-shell="messages"', show: `[data-lh-app-shell="messages"] #lh-messages-shell${FIXED}` },
  { id: "lh-declutter-shell", htmlAttr: 'data-lh-app-shell="declutter"', show: `[data-lh-app-shell="declutter"] #lh-declutter-shell${FIXED}` },
];
/**
 * Ceiling on the inlined block, gzip bytes; the build fails above it. This is a cap on what every page's HTML
 * carries; not raised (lead 11-05). The landing alone measured 8,113 B on the 2026-11-05 build of c477530839; with
 * the /login and /signup shells it was 9,888 B, and dropping the tokens no kept rule reads brought all three to 7,730 B
 * (2026-11-05 build of 8acdf7446d + this change).
 */
export const MAX_INLINE_BYTES = 8_500;

/** The markup of the shell with this id in `html` (start of its div up to its end marker), or null when absent. */
export function shellBlock(html, id) {
  const a = html.indexOf(`<div id="${id}"`);
  if (a < 0) return null;
  const b = html.indexOf(SHELL_END, a);
  return b < 0 ? null : html.slice(a, b);
}

/** Classes, ids and element names the shell markup uses (the test's inventory of what the shell is made of). */
export function shellVocabulary(shellHtml) {
  const classes = new Set();
  for (const m of shellHtml.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(decodeEntities(c));
  const ids = new Set([...shellHtml.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
  const tags = new Set([...shellHtml.matchAll(/<([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  return { classes, ids, tags };
}

function decodeEntities(s) {
  // &amp; last, so "&amp;lt;" decodes once to "&lt;", never twice to "<" (CodeQL js/double-escaping).
  return s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// A first frame has no hover, focus or press, and a pseudo-element hangs off a real element: match each selector with
// those taken out, so ".x:hover" and ".x::before" are kept exactly when ".x" is on the page.
const PSEUDO_ELEMENT = /::?(?:before|after|placeholder|selection|marker|backdrop|file-selector-button|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+|-ms-[\w-]+)(?![\w-])/g;
const DYNAMIC = /:(?:hover|focus|focus-visible|focus-within|active|visited|target|autofill)(?![\w-])/g;

/**
 * The page at its first frame: the shell inside the boot document, with <html> marked the way index.html's inline
 * scripts mark it for a guest on "/" (data-lh-landing-shell), once per theme.
 */
export function shellDocuments(shellHtml, htmlAttr = SHELLS[0].htmlAttr) {
  return ["light", "dark"].map(
    (theme) =>
      new JSDOM(`<!doctype html><html lang="en" data-theme="${theme}" ${htmlAttr}><head></head><body><div id="root"></div>${shellHtml}</div></body></html>`).window.document,
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

/**
 * The subset of `css` the shell markup needs, in source order. `shellHtml` is one shell's markup (the landing), or a
 * list of { html, htmlAttr } for several shells: a rule is kept when it matches in any of their first frames.
 */
export function shellCriticalCss(shellHtml, css) {
  const shells = typeof shellHtml === "string" ? [{ html: shellHtml, htmlAttr: SHELLS[0].htmlAttr }] : shellHtml;
  const docs = shells.flatMap((s) => shellDocuments(s.html, s.htmlAttr));
  const root = postcss.parse(css);
  root.walkAtRules((at) => {
    // Animations are not part of a first frame.
    if (/keyframes$/.test(at.name)) at.remove();
  });
  // A first frame has no hover, focus or press (the trim plan, Q2705 B): a selector that needs one is dropped here
  // (".x" stays, ".x:hover" goes); the full app sheet brings it back when it arrives, before anyone can use it.
  // Inside :not() it is the other way round: ".x:not(:focus-visible)" applies at first frame, so it is judged as before.
  const dynamic = (s) => new RegExp(DYNAMIC.source).test(s.replace(/:not\([^()]*\)/g, ""));
  root.walkRules((rule) => {
    const keep = rule.selectors.filter((s) => !dynamic(s) && selectorNeeded(s, docs));
    if (keep.length === 0) rule.remove();
    else rule.selectors = keep;
  });
  // Nor motion: with the @keyframes gone an animation draws nothing, and a transition only acts on a later change.
  root.walkDecls(/^(?:-webkit-)?(?:transition|animation)(?:-[\w-]+)?$|^will-change$/, (d) => d.remove());
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
  // A custom property no kept declaration and no shell style="" reads (directly or through another property) is not
  // part of the first frame: the token blocks (:root, [data-theme=dark]) carry hundreds the shells never use. The full
  // sheet still defines every one when it arrives.
  const used = new Set();
  const refs = (v) => [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  for (const s of shells) for (const n of refs(s.html)) used.add(n);
  const custom = new Map();
  root.walkDecls((d) => {
    if (d.prop.startsWith("--")) {
      if (!custom.has(d.prop)) custom.set(d.prop, []);
      custom.get(d.prop).push(d.value);
    } else for (const n of refs(d.value)) used.add(n);
  });
  for (const queue = [...used]; queue.length; ) {
    for (const v of custom.get(queue.pop()) ?? []) for (const n of refs(v)) if (!used.has(n)) { used.add(n); queue.push(n); }
  }
  root.walkDecls((d) => { if (d.prop.startsWith("--") && !used.has(d.prop)) d.remove(); });
  root.walkRules((rule) => { if (rule.nodes.length === 0) rule.remove(); });
  // Drop at-rules left empty (twice: an @media inside an emptied @supports).
  for (let i = 0; i < 2; i++) root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove(); });
  return root.toString().replace(/\n+/g, "");
}

/** index.html with every present shell's critical CSS and show rule in <head>. */
export function inlineShellCss(html, css) {
  if (shellBlock(html, SHELLS[0].id) === null) throw new Error("inline-shell-css: index.html has no #lh-landing-shell block");
  if (html.includes(`<style id="${STYLE_ID}">`)) throw new Error("inline-shell-css: already inlined (run once per build)");
  const present = SHELLS.map((s) => ({ ...s, html: shellBlock(html, s.id) }))
    .filter((s) => s.html !== null)
    .map((s) => (s.extra ? { ...s, html: s.html + s.extra } : s));
  const critical = shellCriticalCss(present, css);
  const block = `<style id="${STYLE_ID}">${critical}${present.map((s) => s.show).join("")}</style>`;
  const head = html.indexOf("</head>");
  if (head < 0) throw new Error("inline-shell-css: no </head>");
  // BEFORE the app stylesheet, never after it (live 11-05: the desktop rail vanished on every page). The block is a
  // subset of that sheet, so the sheet must come LATER and repeat every rule in its own order. Placed after it, the
  // block's `.hidden{display:none}` (the landing and auth shells use `hidden`) out-ranked the sheet's
  // `@media (min-width:1024px){.lg\:flex{display:flex}}`, so the rail (`hidden lg:flex`) stayed display:none.
  // Guard: src/test/inlineShellCssBeforeAppSheet.test.ts.
  const sheet = html.indexOf('<link rel="stylesheet" href="/assets/');
  const at = sheet >= 0 && sheet < head ? sheet : head;
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
  const from = out.indexOf(`<style id="${STYLE_ID}">`);
  const gz = gzipSync(out.slice(from, out.indexOf("</style>", from) + "</style>".length)).length;
  if (gz > MAX_INLINE_BYTES) throw new Error(`inline-shell-css: inlined block is ${gz} B gz, over ${MAX_INLINE_BYTES}`);
  writeFileSync(indexPath, out);
  console.log(`inline-shell-css: ${bytes} B (${gz} B gz) of the app sheet inlined for the HTML-drawn first screen`);
}
