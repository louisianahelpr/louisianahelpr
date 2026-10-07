// @mutate src/components/mobileNav/DockCurtain.tsx |           backdropFilter: CURTAIN_BLUR,\n          WebkitBackdropFilter: CURTAIN_BLUR, |           backdropFilter: CURTAIN_BLUR,\n          WebkitBackdropFilter: CURTAIN_BLUR,\n          WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",
// @mutate src/components/mobileNav/DockCurtain.tsx |           top: CURTAIN_BLUR_TOP, |           height: "calc(var(--safe-area-bottom, 0px) + 120px)",
// @mutate src/components/mobileNav/DockCurtain.tsx |           maskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n          WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n          background: | backdropFilter: "blur(32px)",\n          maskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n          WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",\n          background:
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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(__dirname, "..");
// Listed from git (Q1142): shipped source only, never tests.
const FILES = trackedFiles("src")
  .filter((f) => /\.(tsx|ts|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"))
  .map((f) => join(ROOT, f));

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

  it("the dock curtain blurs: one unmasked layer whose edge sits under the pill's top", () => {
    const nav = blankComments(readFileSync(join(SRC, "components/mobileNav/DockCurtain.tsx"), "utf8"));
    // The edge must be hidden behind the pill: anchored to the nav's own top, a few px down.
    const top = /const CURTAIN_BLUR_TOP = "(\d+)px";/.exec(nav);
    expect(top, "CURTAIN_BLUR_TOP").not.toBeNull();
    expect(Number(top![1])).toBeGreaterThan(0);
    expect(Number(top![1])).toBeLessThanOrEqual(16);
    expect(nav).toMatch(/const CURTAIN_BLUR = "blur\(\d+px\)[^"]*";/);
    // …and actually rendered with a backdrop filter, anchored by `top`, never by a height share.
    const layer = styleObjects(nav).filter((s) => /backdropFilter:\s*CURTAIN_BLUR\b/.test(s));
    expect(layer.length).toBe(1);
    expect(layer[0]).toMatch(/top:\s*CURTAIN_BLUR_TOP/);
    expect(layer[0]).toMatch(/WebkitBackdropFilter:\s*CURTAIN_BLUR\b/);
  });
});
