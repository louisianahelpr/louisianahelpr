#!/usr/bin/env node
/**
 * Source-derived inventory of low-alpha FOREGROUND (text/icon) colours.
 *
 * WHY THIS EXISTS. On 2026-09-20 a decorative "·" separator styled
 * `hsl(var(--burnt-sienna) / 0.5)` was caught by the changed-route a11y sweep at
 * 2.33:1 against a 4.5:1 requirement. It was fixed on ONE screen — and three
 * byte-identical copies stayed live on three other screens, because the sweep
 * only visits routes a diff touches. Nobody had the list.
 *
 * So: derive the list from source, not from memory. Every declaration that puts
 * an alpha on a foreground colour is composited over each REAL surface token
 * (card and page, light and dark — exactly what the browser paints, which is
 * what axe measures) and scored. A token's own contrast is irrelevant; the
 * composite is what a person sees.
 *
 * Run:  node scripts/a11y/low-alpha-text-inventory.mjs [--json]
 * Exits 1 if anything is below the AA floor, so it can gate.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const AA_NORMAL = 4.5;

const css = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");

// --- token table, parsed from index.css, per theme --------------------------
// The dark theme re-declares a subset of the same names; anything it does not
// re-declare keeps its light value, so dark inherits from light.
function parseTokens(block) {
  const t = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%/g)) {
    t[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return t;
}
const darkStart = css.search(/--parchment:\s*220 14% 9%/);
if (darkStart < 0) throw new Error("could not find the dark-theme token block in src/index.css");
const LIGHT = parseTokens(css.slice(0, darkStart));
const DARK = { ...LIGHT, ...parseTokens(css.slice(darkStart)) };

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// --- walk src/ --------------------------------------------------------------
export function collectLowAlphaForegrounds() {
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "src"));

// FOREGROUND declarations only. `background`, `border`, `boxShadow` and
// `outline` are deliberately excluded: a 0.12 alpha wash is a surface, not ink,
// and AA text contrast does not apply to it.
//
// NOTE: we do not strip comments before matching. A previous lane stripped `//`
// out of a base64 blob and hashed the empty string. Matching the raw text costs
// us a handful of hits inside comment blocks, which is the safe direction to
// err — a commented-out declaration is reported and dismissed by a human, a
// deleted one is invisible.
// The negative lookbehind matters: `\bcolor:` also matches the tail of
// `background-color:` and `border-color:` (a hyphen IS a word boundary), which
// on the first run drowned 58 "failures" in washes and hairlines that AA text
// contrast does not govern at all.
const SHAPES = [
  [/(?<![-\w])color:\s*["'`]?hsl\(var\(--([a-z0-9-]+)\)\s*\/\s*([0-9.]+)\)/g, "color"],
  [/\btext-\[hsl\(var\(--([a-z0-9-]+)\)\s*\/\s*([0-9.]+)\)\]/g, "tw-text"],
];

const SURFACES = [
  ["light card", LIGHT, "ivory-sand"],
  ["light page", LIGHT, "parchment"],
  ["dark card", DARK, "ivory-sand"],
  ["dark page", DARK, "parchment"],
];

const rows = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const [re, kind] of SHAPES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const token = m[1];
      const alpha = parseFloat(m[2]);
      if (alpha >= 1) continue;
      const lineNo = src.slice(0, m.index).split("\n").length;
      const scored = [];
      for (const [name, theme, surfaceToken] of SURFACES) {
        if (!theme[token] || !theme[surfaceToken]) continue;
        const fg = hslToRgb(...theme[token]);
        const bg = hslToRgb(...theme[surfaceToken]);
        scored.push([name, contrast(composite(fg, alpha, bg), bg)]);
      }
      if (!scored.length) continue;
      const worst = scored.reduce((a, b) => (b[1] < a[1] ? b : a));
      rows.push({
        file: path.relative(ROOT, file),
        line: lineNo,
        kind,
        token,
        alpha,
        worst,
        scored,
        source: (lines[lineNo - 1] || "").trim().slice(0, 120),
      });
    }
  }
}

rows.sort((a, b) => a.worst[1] - b.worst[1]);
return { fileCount: files.length, rows, failing: rows.filter((r) => r.worst[1] < AA_NORMAL) };
}

// --- CLI --------------------------------------------------------------------
// Guarded, so importing this module from a test does not print or exit.
if (process.argv[1] && process.argv[1].endsWith("low-alpha-text-inventory.mjs")) {
const { fileCount: files, rows, failing } = collectLowAlphaForegrounds();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total: rows.length, failing }, null, 2));
} else {
  console.log(
    `Scanned ${files} source files.\n` +
      `${rows.length} alpha'd foreground declarations.\n` +
      `${failing.length} below the ${AA_NORMAL}:1 AA floor on at least one real surface.\n`,
  );
  for (const r of failing) {
    console.log(`  ${r.worst[1].toFixed(2)}:1  ${r.file}:${r.line}  --${r.token} / ${r.alpha}  [${r.kind}]`);
    console.log(`           ${r.scored.map(([n, v]) => `${n} ${v.toFixed(2)}`).join("   ")}`);
    console.log(`           ${r.source}\n`);
  }
  console.log(`--- clears AA (${rows.length - failing.length}) ---`);
  for (const r of rows.filter((r) => r.worst[1] >= AA_NORMAL)) {
    console.log(`  ${r.worst[1].toFixed(2)}:1  ${r.file}:${r.line}  --${r.token} / ${r.alpha}`);
  }
}

process.exit(failing.length ? 1 : 0);
}
