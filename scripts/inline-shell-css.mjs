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
 * This step reads the built sheet, keeps only the rules whose every class, id and element appears in the shell markup
 * (plus the :root / html / body / * rules they read, such as the colour tokens and preflight), and writes them, with
 * the shell's show rule, into a <style id="lh-shell-css"> in <head>. They are the app's own compiled rules, in the
 * app's own order, so the shell looks exactly as it did; the full sheet still loads as before and repeats them.
 *
 * Wired into `npm run build` after `vite build` and before build-og-shell.mjs, so api/share.ts serves the same head.
 * Guard: src/test/shellCriticalCss.test.ts.
 *
 *   node scripts/inline-shell-css.mjs            # rewrite dist/index.html
 *   node scripts/inline-shell-css.mjs --print    # also print what was kept
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

export const SHELL_START = '<div id="lh-landing-shell"';
export const SHELL_END = '<span data-lh-shell="end" hidden></span>';
export const STYLE_ID = "lh-shell-css";
/** The show rule that src/index.css also carries; inline it too, or the inlined rules style a hidden block. */
export const SHOW_RULE =
  "[data-lh-landing-shell] #lh-landing-shell{display:block;position:fixed;inset:0;z-index:2147483000;overflow:hidden}";
/** Ceiling on the inlined block, gzip bytes: the build fails above it (6,892 B measured on the 11-05 prototype). */
export const MAX_INLINE_BYTES = 40_000;

const ALWAYS_TAGS = new Set(["*", "html", "body", ":root"]);

/** Classes, ids and element names the shell markup uses. */
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

const unescapeCss = (s) => s.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_, c) => (/^[0-9a-fA-F]/.test(c) && c.length > 1 ? String.fromCodePoint(parseInt(c, 16)) : c));

/** True when every class, id and element in one selector is in the shell's vocabulary. */
export function selectorNeeded(sel, vocab) {
  // Pseudo-class arguments such as :not(.x) or :where(...) are left in for the class check: a rule under
  // :not(.absent) is kept only when .absent is present too, which can only keep less, never style wrongly.
  const noAttrs = sel.replace(/\[[^\]]*\]/g, " ");
  for (const m of noAttrs.matchAll(/\.((?:\\.|[\w-])+)/g)) if (!vocab.classes.has(unescapeCss(m[1]))) return false;
  for (const m of noAttrs.matchAll(/#((?:\\.|[\w-])+)/g)) if (!vocab.ids.has(unescapeCss(m[1]))) return false;
  const bare = noAttrs
    .replace(/::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, " ")
    .replace(/\.((?:\\.|[\w-])+)/g, " ")
    .replace(/#((?:\\.|[\w-])+)/g, " ");
  for (const t of bare.split(/[\s>+~,()]+/).filter(Boolean)) {
    if (ALWAYS_TAGS.has(t)) continue;
    if (!vocab.tags.has(t)) return false;
  }
  return true;
}

/** The subset of `css` the shell markup needs, in source order. */
export function shellCriticalCss(shellHtml, css) {
  const vocab = shellVocabulary(shellHtml);
  const root = postcss.parse(css);
  root.walkAtRules((at) => {
    // Animations are not part of a first frame.
    if (/keyframes$/.test(at.name)) at.remove();
  });
  root.walkRules((rule) => {
    const keep = rule.selectors.filter((s) => selectorNeeded(s, vocab));
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
  if (process.argv.includes("--print")) console.log(readdirSync(dist).length, "entries in dist");
}
