// @mutate src/components/MobileNav.tsx |               backdropFilter: filter,\n              WebkitBackdropFilter: filter, |               backdropFilter: filter,\n              WebkitBackdropFilter: filter,\n              WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",
// @mutate src/components/MobileNav.tsx |             maskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n            WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n            background: | backdropFilter: "blur(32px)",\n            maskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n            WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n            background:
//
// Q7 (owner, WebKit only: "the bottom nav isn't frosted"). Measured 2026-10-07 on
// the iOS 26.5 simulator (WKWebView) with a striped probe under the dock: the dock
// pill (backdrop-filter, no mask) blurred it; the curtain band (backdrop-filter AND
// mask-image on ONE element) left it crisp. WebKit drops the backdrop filter on an
// element that also carries a mask, and a mask on an ANCESTOR is no fix (it makes a
// backdrop root, so the blur samples nothing: tried, same day). Chromium blurs both,
// so no Chromium check could see it.
//
// CLASS: no element anywhere in src/ may carry a backdrop filter and a mask image
// together, whether as one inline style object (TSX) or one CSS rule (CSS).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const SRC = resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);

/** Every `{ … }` object literal that directly follows `style=`, brace-matched. */
function styleObjects(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/style=\{\{/g)) {
    let depth = 0;
    const start = (m.index ?? 0) + "style={".length;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) {
        out.push(code.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}
/** Every CSS rule body `{ … }` that holds declarations (innermost blocks). */
function cssRules(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
}
const BACKDROP_TSX = /\b(?:Webkit)?[bB]ackdropFilter\s*:/;
const MASK_TSX = /\b(?:Webkit)?[mM]askImage\s*:/;
const BACKDROP_CSS = /(?:^|[;\s])(?:-webkit-)?backdrop-filter\s*:/;
const MASK_CSS = /(?:^|[;\s])(?:-webkit-)?mask(?:-image)?\s*:/;

describe("no element carries a backdrop filter and a mask image together (Q7, WebKit)", () => {
  it("inline style objects", () => {
    let withBackdrop = 0;
    const both: string[] = [];
    for (const f of FILES.filter((p) => /\.tsx?$/.test(p))) {
      for (const s of styleObjects(blankComments(readFileSync(f, "utf8")))) {
        if (!BACKDROP_TSX.test(s)) continue;
        withBackdrop++;
        if (MASK_TSX.test(s)) both.push(`${f.slice(SRC.length + 1)}: ${s.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(withBackdrop, "inventory floor: style objects with a backdrop filter").toBeGreaterThan(5);
    expect(both).toEqual([]);
  });

  it("CSS rules", () => {
    let withBackdrop = 0;
    const both: string[] = [];
    for (const f of FILES.filter((p) => p.endsWith(".css"))) {
      for (const r of cssRules(blankCssComments(readFileSync(f, "utf8")))) {
        if (!BACKDROP_CSS.test(r)) continue;
        withBackdrop++;
        if (MASK_CSS.test(r)) both.push(`${f.slice(SRC.length + 1)}: ${r.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(withBackdrop, "inventory floor: CSS rules with a backdrop filter").toBeGreaterThan(3);
    expect(both).toEqual([]);
  });

  it("the dock curtain blurs with unmasked steps that ramp up toward the bottom", () => {
    const nav = readFileSync(join(SRC, "components/MobileNav.tsx"), "utf8");
    const block = nav.slice(nav.indexOf("const CURTAIN_BLUR_STEPS"), nav.indexOf("];", nav.indexOf("const CURTAIN_BLUR_STEPS")));
    const steps = [...block.matchAll(/\[\s*([\d.]+)\s*,\s*"blur\((\d+)px\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i][0], "each step shorter than the last").toBeLessThan(steps[i - 1][0]);
      expect(steps[i][1], "and stronger").toBeGreaterThan(steps[i - 1][1]);
    }
    expect(steps[0][0]).toBe(1);
    expect(steps[steps.length - 1][0]).toBe(0.35);
    expect(nav).toMatch(/CURTAIN_BLUR_STEPS\.map\(/);
  });
});
