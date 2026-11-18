/*
 * GUARD (audit 2026-10-28 P5-7): the landing's top bar is OPAQUE. At 84% of
 * --lp-ground the content scrolling under it showed through at 375 ("JUST
 * FINISHED" and a job photo behind the logo row). Every rule outside a media
 * block that paints `.landing-page .glass-nav` must give an opaque colour, and
 * the token it reads (--lp-page since owner 2026-11-17, the white page; --lp-ground before) must be opaque in light
 * and dark. The hero itself is not touched.
 */
// @mutate src/index.css | .landing-page .glass-nav { background-color: var(--lp-page); } | .landing-page .glass-nav { background-color: color-mix(in srgb, var(--lp-page) 84%, transparent); }
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const CSS = blankComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));

/** The CSS with every @media block's body removed (their rules are not the default paint). */
function topLevel(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at < 0) { out += css.slice(i); break; }
    out += css.slice(i, at);
    let j = css.indexOf("{", at);
    let depth = 0;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

const translucent = (v: string) => /transparent|hsla|rgba|\/\s*0?\.\d|,\s*0?\.\d+\s*\)|#[0-9a-f]{8}\b/i.test(v);

describe("the landing's top bar is opaque (P5-7)", () => {
  const top = topLevel(CSS);
  // Owner decision 11-18 (hero mockup B, "Color band"): at the very top of the landing (.landing-nav-top, set by
  // Navbar only while scrollY is 0) the bar is see-through so the hero band runs behind it; nothing scrolls under it
  // then. That one modifier is exempt; every other paint rule, including the scrolled bar, stays opaque.
  const rules = [...top.matchAll(/([^{}]*\.landing-page\s+\.glass-nav[^{}]*)\{([^}]*)\}/g)].filter((r) => !/\.landing-nav-top\b/.test(r[1]));

  it("finds the landing bar's paint rule (not vacuous)", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("every default rule for .landing-page .glass-nav paints an opaque background", () => {
    const bgs = rules.flatMap((r) => [...r[2].matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1].trim()));
    expect(bgs.length).toBeGreaterThan(0);
    expect(bgs.filter(translucent)).toEqual([]);
  });

  it("--lp-page, the colour it paints, is opaque in light and dark", () => {
    const grounds = [...CSS.matchAll(/--lp-page:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(grounds.length).toBeGreaterThan(1);
    expect(grounds.filter(translucent)).toEqual([]);
  });
});
