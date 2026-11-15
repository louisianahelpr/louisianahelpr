/**
 * /sponsor AND /25days: THE HERO DOES NOT RE-WRAP WHEN BODONI ARRIVES (prod-audit run 43691657529, 2026-11-15,
 * page-settle 0.060 at 375 on both: "span.lh25-h1-main 213→205 h83→140", the CTAs and countdown pushed 42px).
 *
 * The 25 Days page set its headings in its own stack, "Bodoni Moda", "Didot", "Bodoni 72", Georgia, ... with none of
 * the app's size-matched fallbacks (index.css "Bodoni Moda Fallback" over Georgia, "... Liberation" over Liberation
 * Serif for Linux), and the hero fonts were preloaded only on "/". First paint drew the H1 in Didot (macOS) or the
 * generic serif, then Bodoni re-wrapped it. Measured on a local production build against prod, guest, service workers
 * blocked, every non-GET aborted except the STABLE sponsor_public_state read, 3 runs each
 * (~/.lh-shots/builder3g-1115/cls-before.txt, cls-after.txt): 375 0.0631-0.0635 -> 0.0000, 1440 0.0020 -> 0.0000.
 *
 *   1. sponsor.css's --head lists both size-matched fallback families straight after "Bodoni Moda", Georgia's first
 *      (the same order as tailwind's font-display; heroFontSwapDoesNotShift.test.ts pins that order there);
 *   2. both families are real @font-face families in index.css with a normal 400 face (the hero's weight) and an
 *      italic face (its <em>);
 *   3. index.html's inline script turns the hero preloads on for /sponsor and /25days
 *      (heroFontsPreloadOnlyOnTheLanding.test.ts runs it per path).
 *
 * @mutate src/pages/sponsor/sponsor.css |   --head: "Bodoni Moda", "Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation", "Didot", |   --head: "Bodoni Moda", "Didot",
 * @mutate src/pages/sponsor/sponsor.css |   --head: "Bodoni Moda", "Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation", "Didot", |   --head: "Bodoni Moda", "Didot", "Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation",
 * @mutate src/pages/sponsor/sponsor.css |   --head: "Bodoni Moda", "Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation", "Didot", |   --head: "Bodoni Moda", "Bodoni Moda Fallback Liberation", "Bodoni Moda Fallback", "Didot",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const sponsorCss = blankComments(read("src/pages/sponsor/sponsor.css"));
const appCss = blankComments(read("src/index.css"));

const faces = [...appCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const get = (k: string) => (new RegExp(`${k}\\s*:\\s*([^;]+);`).exec(m[1])?.[1] ?? "").trim();
  return { family: get("font-family").replace(/["']/g, ""), style: get("font-style"), weight: get("font-weight") };
});

describe("25 Days hero: the Bodoni swap does not move the page", () => {
  it("1. --head puts the size-matched fallbacks straight after Bodoni Moda, Georgia's first", () => {
    const head = /--head:\s*([^;]+);/.exec(sponsorCss)?.[1];
    expect(head).toBeDefined();
    const stack = (head ?? "").split(",").map((f) => f.trim().replace(/["']/g, ""));
    expect(stack.length).toBeGreaterThan(3);
    expect(stack.slice(0, 3)).toEqual(["Bodoni Moda", "Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation"]);
    // The hero, the countdown and every heading on the page read --head.
    expect(sponsorCss).toMatch(/\.lh25 h1, \.lh25 h2, \.lh25 h3 \{ font-family: var\(--head\)/);
  });

  it("2. both fallback families exist with the hero's normal 400 and an italic face", () => {
    expect(faces.length).toBeGreaterThan(10);
    for (const family of ["Bodoni Moda Fallback", "Bodoni Moda Fallback Liberation"]) {
      const mine = faces.filter((f) => f.family === family);
      expect(mine.some((f) => f.style === "normal" && f.weight === "400"), family).toBe(true);
      expect(mine.some((f) => f.style === "italic"), family).toBe(true);
    }
  });
});
