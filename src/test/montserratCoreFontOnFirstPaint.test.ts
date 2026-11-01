/**
 * B84 (11-01, Speed: /home on Slow 4G). Montserrat's latin file (35 KB, preloaded on every page) is split by codepoint
 * into a core file (ASCII plus the punctuation the copy uses, ~22 KB, preloaded) and a rest file (accented letters and
 * other latin symbols, fetched only by a page that draws one). Glyphs are unchanged (outlines and advances compared
 * equal at 400-700 with fontTools, ~/.lh-shots/b84). Lab, HTTP/2 Slow 4G, 375, median of 3: /home LCP 2.77 -> 2.66 s.
 *
 * Held here, per Montserrat weight:
 *   - the core and rest unicode-ranges never overlap, and together they are exactly Google's latin range, so no
 *     latin character falls out of Montserrat;
 *   - the preload names the core file, and nothing preloads the rest file;
 *   - the core file stays small (it is on every first paint).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const css = blankComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));
const html = readFileSync(resolve(ROOT, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");

const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

function codepoints(range: string): Set<number> {
  const out = new Set<number>();
  for (const part of range.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.replace(/^U\+/i, "").split("-");
    for (let c = parseInt(a, 16); c <= parseInt(b ?? a, 16); c++) out.add(c);
  }
  return out;
}

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const montserrat = (file: string) =>
  faces
    .filter((f) => /font-family:\s*"Montserrat"/.test(f) && f.includes(`/fonts/montserrat-normal-latin-${file}.woff2`))
    .map((f) => ({ weight: /font-weight:\s*(\d+)/.exec(f)?.[1], range: /unicode-range:\s*([^;]+);/.exec(f)?.[1] ?? "" }));

describe("Montserrat's first paint downloads only the core latin file", () => {
  const core = montserrat("core");
  const rest = montserrat("rest");

  it("every weight has a core face and a rest face, splitting the latin range exactly", () => {
    expect(core.length).toBeGreaterThan(3);
    expect(rest.map((f) => f.weight)).toEqual(core.map((f) => f.weight));
    const latin = codepoints(LATIN);
    for (const c of core) {
      const r = rest.find((x) => x.weight === c.weight)!;
      const a = codepoints(c.range);
      const b = codepoints(r.range);
      for (const cp of a) expect(b.has(cp), `U+${cp.toString(16)} is in both ranges (weight ${c.weight})`).toBe(false);
      const union = new Set([...a, ...b]);
      expect([...union].filter((cp) => !latin.has(cp))).toEqual([]);
      expect([...latin].filter((cp) => !union.has(cp))).toEqual([]);
      // The copy's everyday characters are in the core.
      for (const ch of "Aa0 .,'’“”—–…•·×ñ€") expect(a.has(ch.codePointAt(0)!), `${ch} not in the core range`).toBe(true);
    }
    expect(faces.some((f) => f.includes("/fonts/montserrat-normal-latin.woff2"))).toBe(false);
  });

  it("the preload names the core file only, and the core file stays small", () => {
    const preloads = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]);
    expect(preloads.some((l) => l.includes('href="/fonts/montserrat-normal-latin-core.woff2"'))).toBe(true);
    expect(preloads.some((l) => l.includes("montserrat-normal-latin-rest"))).toBe(false);
    expect(statSync(resolve(ROOT, "public/fonts/montserrat-normal-latin-core.woff2")).size).toBeLessThan(24_000);
  });
});

// @mutate src/index.css | font-weight: 400;\n  font-display: swap;\n  src: url("/fonts/montserrat-normal-latin-core.woff2") format("woff2");\n  unicode-range: U+0000-007F, | font-weight: 400;\n  font-display: swap;\n  src: url("/fonts/montserrat-normal-latin-core.woff2") format("woff2");\n  unicode-range: U+0000-0080,
// @mutate index.html |       href="/fonts/montserrat-normal-latin-core.woff2" |       href="/fonts/montserrat-normal-latin-rest.woff2"
// @mutate src/index.css | font-weight: 700;\n  font-display: swap;\n  src: url("/fonts/montserrat-normal-latin-rest.woff2") format("woff2");\n  unicode-range: U+0080-009F, | font-weight: 700;\n  font-display: swap;\n  src: url("/fonts/montserrat-normal-latin-rest.woff2") format("woff2");\n  unicode-range: U+0081-009F,
