/*
 * EVERY FONT FACE THE LANDING HERO SETS ON ITS FIRST PAINT IS PRELOADED.
 *
 * The hero H1 is "Louisiana's Local Job <em>Partner.</em>" — Bodoni Moda 900
 * with an ITALIC <em>. index.html preloaded the normal Bodoni face and not the
 * italic one, so the <em> painted in the local fallback and re-wrapped when
 * the italic woff2 landed. Where Georgia exists (a Mac) the metric-matched
 * "Bodoni Moda Fallback" hides it (0.0006 measured locally); where it does
 * not (the Linux CI runner, Android) the <em> moved y 377→351 and prod-audit
 * page-settle failed "1440 /: cls=0.0315" in runs 36003051878 and 36069316906.
 *
 * The inventory is DERIVED, never a hand list:
 *   - families: `font-display` on the h1 → tailwind.config.ts `display[0]`,
 *     plus every inline `fontFamily: "X, …"` in HeroSection.tsx;
 *   - styles: normal, plus italic when the h1 subtree sets italic;
 *   - files: the src/index.css @font-face whose family and style match and
 *     whose unicode-range covers ASCII (U+0000-00FF, the latin subset — the
 *     hero's copy is ASCII plus a right quote, both in that subset).
 * Each derived file must be an `as="font"` preload in index.html.
 *
 * @mutate index.html | href="/fonts/bodoni-moda-italic-latin.woff2" | href="/fonts/bodoni-moda-italic-latin-ext.woff2"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const html = read("index.html");
const css = read("src/index.css");
const hero = blankComments(read("src/components/landing/HeroSection.tsx"));
const tailwind = blankComments(read("tailwind.config.ts"));

const unquote = (s: string) => s.trim().replace(/^["'\\]+|["'\\]+$/g, "");

interface Face { family: string; style: string; src: string; latin: boolean }
function fontFaces(): Face[] {
  const faces: Face[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const family = unquote(/font-family:\s*([^;]+);/.exec(body)?.[1] ?? "");
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
    const src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(body)?.[1];
    if (!src) continue; // local()-only metric fallbacks: nothing to download
    faces.push({ family, style, src, latin: /unicode-range:\s*U\+0000-00FF/i.test(body) });
  }
  return faces;
}

function heroNeeds(): { family: string; style: string }[] {
  const h1 = /<h1[\s\S]*?<\/h1>/.exec(hero)?.[0] ?? "";
  expect(h1, "no <h1> in HeroSection.tsx").not.toBe("");
  const needs: { family: string; style: string }[] = [];
  if (/\bfont-display\b/.test(h1)) {
    const display = /display:\s*\[\s*("(?:\\.|[^"])*"|'[^']*')/.exec(tailwind)?.[1];
    expect(display, "could not read tailwind fontFamily.display").toBeTruthy();
    const family = unquote(display!.slice(1, -1));
    needs.push({ family, style: "normal" });
    if (/fontStyle:\s*["']italic["']|\bitalic\b/.test(h1)) needs.push({ family, style: "italic" });
  }
  for (const m of hero.matchAll(/fontFamily:\s*["']([^"',]+)/g)) {
    const family = unquote(m[1]);
    if (!needs.some((n) => n.family === family && n.style === "normal")) needs.push({ family, style: "normal" });
  }
  return needs;
}

const preloads = [...html.matchAll(/<link\b([^>]*)>/g)]
  .map((m) => m[1])
  .filter((a) => /rel="preload"/.test(a) && /as="font"/.test(a))
  .map((a) => /href="([^"]+)"/.exec(a)?.[1] ?? "");

describe("the landing hero's first-paint fonts are preloaded", () => {
  it("derives a non-empty inventory (hero faces and @font-face files)", () => {
    const faces = fontFaces();
    // Floor: far fewer @font-face blocks than index.css holds means the parser broke.
    expect(faces.length).toBeGreaterThan(10);
    // Bodoni normal + Bodoni italic + Montserrat: the three the hero sets.
    expect(heroNeeds().length).toBeGreaterThanOrEqual(3);
  });

  it("every face the hero sets has its latin file preloaded", () => {
    const faces = fontFaces();
    const missing: string[] = [];
    for (const n of heroNeeds()) {
      const files = [...new Set(faces.filter((f) => f.family === n.family && f.style === n.style && f.latin).map((f) => f.src))];
      expect(files.length, `no latin @font-face for ${n.family} ${n.style} in src/index.css`).toBeGreaterThan(0);
      for (const f of files) if (!preloads.includes(f)) missing.push(`${n.family} ${n.style}: ${f}`);
    }
    expect(missing, "hero font faces with no <link rel=\"preload\" as=\"font\"> in index.html").toEqual([]);
  });

  it("every font preload carries crossorigin (else it is a second, wasted download)", () => {
    const tags = [...html.matchAll(/<link\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /as="font"/.test(a));
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t, t).toMatch(/\bcrossorigin\b/);
  });
});
