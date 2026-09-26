/**
 * Q371 — the landing hero does not move when its fonts arrive, on ANY device.
 *
 * CI's page-settle spec measured CLS 0.0315 at 1440 on Linux (budget 0.02),
 * reproduced exactly on a Linux Chromium: the hero <em> (Bodoni ITALIC) was
 * not preloaded, so it swapped in ~300ms after first paint, and on a device
 * without Georgia the size-matched "Bodoni Moda Fallback" (local("Georgia"))
 * resolved to nothing, leaving an unmatched generic serif underneath.
 * Measured after the fix, preview build, Linux Chromium: 0.0000 at 1440 and
 * 375 unthrottled; 0.0021 / 0.0044 with fonts delayed 400ms (was 0.0684 /
 * 0.0226). The runtime check is e2e/prod-audit/page-settle.spec.ts (Linux CI,
 * CLS_BUDGET 0.02, KNOWN empty); this file holds the two loading rules in
 * place without a browser:
 *   1. every LATIN-subset Bodoni Moda file (the hero's glyphs, normal and
 *      italic) is preloaded in index.html, crossorigin;
 *   2. every "Bodoni Moda Fallback" face (Georgia) has a
 *      "Bodoni Moda Fallback Liberation" twin of the same style and weight,
 *      and both families sit in every Bodoni font stack, Georgia's first.
 */
// @mutate index.html |       href="/fonts/bodoni-moda-italic-latin.woff2" |       href="/fonts/bodoni-moda-italic-latin-ext.woff2"
// @mutate tailwind.config.ts | "\"Bodoni Moda Fallback\"", "\"Bodoni Moda Fallback Liberation\"", | "\"Bodoni Moda Fallback\"",
// @mutate src/index.css |   font-style: italic;\n  font-weight: 700;\n  src: local("Liberation Serif Bold Italic") |   font-style: italic;\n  font-weight: 800;\n  src: local("Liberation Serif Bold Italic")
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const css = blankComments(read("src/index.css"));
/** index.html without its comments (a loop, not a one-pass regex, so no comment survives). */
function withoutHtmlComments(src: string): string {
  let out = src;
  for (;;) {
    const start = out.indexOf("<!--");
    if (start < 0) return out;
    const end = out.indexOf("-->", start + 4);
    out = end < 0 ? out.slice(0, start) : out.slice(0, start) + out.slice(end + 3);
  }
}
const html = withoutHtmlComments(read("index.html"));

type Face = { family: string; style: string; weight: string; src: string; range: string };
const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const get = (k: string) => (new RegExp(`${k}\\s*:\\s*([^;]+);`).exec(m[1])?.[1] ?? "").trim();
  return {
    family: get("font-family").replace(/["']/g, ""),
    style: get("font-style"),
    weight: get("font-weight"),
    src: get("src"),
    range: get("unicode-range"),
  };
});

describe("hero font loading (Q371)", () => {
  it("every latin-subset Bodoni Moda file is preloaded, crossorigin", () => {
    const latinFiles = [
      ...new Set(
        faces
          .filter((f) => f.family === "Bodoni Moda" && /U\+0000-00FF/.test(f.range))
          .map((f) => /url\("([^"]+)"\)/.exec(f.src)?.[1] ?? ""),
      ),
    ];
    // normal + italic: the H1 and its <em>.
    expect(latinFiles.length).toBeGreaterThanOrEqual(2);
    const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]);
    const missing = latinFiles.filter(
      (href) => !preloads.some((l) => l.includes(`href="${href}"`) && /as="font"/.test(l) && /\bcrossorigin\b/.test(l)),
    );
    expect(missing, "hero font file left to the late @font-face fetch").toEqual([]);
  });

  it("every Georgia fallback face has a Liberation Serif twin", () => {
    const georgia = faces.filter((f) => f.family === "Bodoni Moda Fallback");
    const liberation = faces.filter((f) => f.family === "Bodoni Moda Fallback Liberation");
    expect(georgia.length).toBeGreaterThanOrEqual(5);
    const key = (f: Face) => `${f.style} ${f.weight}`;
    expect(liberation.map(key).sort()).toEqual(georgia.map(key).sort());
    for (const f of liberation) {
      expect(f.src, key(f)).toMatch(/local\("Liberation Serif/);
    }
  });

  it("every Bodoni stack lists Georgia's fallback, then Liberation's, before the generic", () => {
    const stacks = [
      ...[...css.matchAll(/font-family:\s*("Bodoni Moda"\s*,[^;]*);/g)].map((m) => m[1]),
      ...[...read("tailwind.config.ts").matchAll(/\[\s*"\\"Bodoni Moda\\""[^\]]*\]/g)].map((m) => m[0].replace(/\\"/g, '"')),
    ];
    expect(stacks.length).toBeGreaterThanOrEqual(2);
    for (const s of stacks) {
      const g = s.indexOf('"Bodoni Moda Fallback"');
      const l = s.indexOf('"Bodoni Moda Fallback Liberation"');
      expect(g, s).toBeGreaterThan(-1);
      expect(l, s).toBeGreaterThan(g);
    }
  });
});
