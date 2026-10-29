/*
 * GUARD (audit 2026-10-28 P5-7): the landing's top bar is OPAQUE. At 84% of
 * --lp-ground the content scrolling under it showed through at 375 ("JUST
 * FINISHED" and a job photo behind the logo row). Every rule outside a media
 * block that paints `.landing-page .glass-nav` must give an opaque colour, and
 * the token it reads (--lp-ground) must be opaque in light and dark. The hero
 * itself is not touched.
 */
// @mutate src/index.css | .landing-page .glass-nav { background-color: var(--lp-ground); } | .landing-page .glass-nav { background-color: color-mix(in srgb, var(--lp-ground) 84%, transparent); }
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
  const rules = [...top.matchAll(/([^{}]*\.landing-page\s+\.glass-nav[^{}]*)\{([^}]*)\}/g)];

  it("finds the landing bar's paint rule (not vacuous)", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("every default rule for .landing-page .glass-nav paints an opaque background", () => {
    const bgs = rules.flatMap((r) => [...r[2].matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1].trim()));
    expect(bgs.length).toBeGreaterThan(0);
    expect(bgs.filter(translucent)).toEqual([]);
  });

  it("--lp-ground, the colour it paints, is opaque in light and dark", () => {
    const grounds = [...CSS.matchAll(/--lp-ground:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(grounds.length).toBeGreaterThan(1);
    expect(grounds.filter(translucent)).toEqual([]);
  });
});
