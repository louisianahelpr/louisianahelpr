/*
 * GUARD (docs/OPEN.md Q1128): under prefers-reduced-transparency the nav dock
 * pill and its curtain paint an OPAQUE form of their own colour, per theme.
 *
 * Both are inline styles in MobileNav.tsx, so no class-based reduced-
 * transparency rule can reach them: they read --nav-pill-bg and
 * --nav-curtain-top, and src/index.css redefines those tokens opaque inside
 * the @media (prefers-reduced-transparency: reduce) block. Nothing failed if
 * either side drifted (a hard-coded rgba in MobileNav, or the override
 * dropped), so a user who asked for less transparency got the 40% pill back.
 */
// @mutate src/index.css |     --nav-pill-bg:      hsl(0 0% 100%); |     --nav-pill-bg:      hsla(0, 0%, 100%, 0.40);
// @mutate src/components/MobileNav.tsx | backgroundColor: "var(--nav-pill-bg)", | backgroundColor: "hsla(0, 0%, 100%, 0.40)",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const CSS = readFileSync(join(ROOT, "src/index.css"), "utf8");
const NAV = readFileSync(join(ROOT, "src/components/MobileNav.tsx"), "utf8");

/** The body of the first @media (prefers-reduced-transparency: reduce) block, comments stripped. */
function reducedTransparencyBlock(): string {
  const at = CSS.indexOf("@media (prefers-reduced-transparency: reduce)");
  expect(at, "the reduced-transparency media block is gone").toBeGreaterThan(0);
  let depth = 0;
  let i = CSS.indexOf("{", at);
  const start = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) break;
  }
  return blankComments(CSS.slice(start, i + 1));
}

/** Declared values of `prop` inside `css`, in order. */
const valuesOf = (css: string, prop: string) => [...css.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
const isOpaque = (v: string) => !/hsla|rgba|\/\s*0?\.\d|,\s*0?\.\d+\s*\)/.test(v);

describe("nav dock under prefers-reduced-transparency (Q1128)", () => {
  const block = reducedTransparencyBlock();

  it("redefines the pill and curtain tokens, and every value is opaque", () => {
    for (const prop of ["--nav-pill-bg", "--nav-curtain-top"]) {
      const vals = valuesOf(block, prop);
      expect(vals.length, `${prop} is not redefined inside the media block`).toBeGreaterThan(0);
      for (const v of vals) expect(isOpaque(v), `${prop}: ${v} is still translucent`).toBe(true);
    }
  });

  it("gives dark mode its own opaque pill (not light's white)", () => {
    const dark = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(block)?.[1] ?? "";
    const pill = valuesOf(dark, "--nav-pill-bg");
    expect(pill.length).toBe(1);
    expect(isOpaque(pill[0])).toBe(true);
    expect(pill[0]).not.toBe("hsl(0 0% 100%)");
  });

  it("MobileNav paints both surfaces from those tokens, not a literal colour", () => {
    expect(NAV).toContain('backgroundColor: "var(--nav-pill-bg)"');
    expect(NAV).toContain("var(--nav-curtain-top)");
  });
});
