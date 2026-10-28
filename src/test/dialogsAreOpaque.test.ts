/**
 * EVERY POPUP IS A SOLID CARD (lead, ui-polish 2026-10-28, item 3: the job dialog at 1440 showed the feed's cards and
 * words through its body; ~/.lh-shots/ui-polish-1028/after-item9/detail-1440.png).
 *
 * `.glass-modal` is THE popup surface: DialogContent and SheetContent (src/components/ui/dialog.tsx, sheet.tsx) and
 * every hand-built popup that wears it. It was `hsl(var(--background) / 0.95)` over `blur(40px)` (dark: 92%), so
 * whatever sat under a dialog stayed readable through it wherever the blur was not painted. Now every rule that
 * paints `.glass-modal` paints an OPAQUE fill in that theme's own colour (CLAUDE.md: reduced transparency = the
 * opaque form of each surface's OWN colour, per theme), and no rule gives it a backdrop filter.
 *
 * @mutate src/index.css |   background-color: hsl(var(--background));\n  box-shadow: 0 30px 80px -20px | background-color: hsl(var(--background) / 0.95);\n  box-shadow: 0 30px 80px -20px
 * @mutate src/index.css |   background-color: hsl(20 12% 13%); /* opaque, as light | background-color: hsl(20 12% 13% / 0.92); /* opaque, as light
 * @mutate src/index.css |   background-color: hsl(var(--background));\n  box-shadow: 0 30px 80px -20px | background-color: hsl(var(--background));\n  backdrop-filter: blur(40px);\n  box-shadow: 0 30px 80px -20px
 * @mutate src/components/ui/dialog.tsx |         "glass-modal z-50 grid | "z-50 grid
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const css = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

/** Every innermost `selector { declarations }` block whose selector names `.glass-modal`. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] }))
  .filter((r) => /\.glass-modal\b/.test(r.selector));

/** A colour value with an alpha below 1: `hsl(x / 0.9)`, `hsla(..., 0.9)`, `rgba(..., 0.9)`, `transparent`. */
const translucent = (value: string) =>
  /\/\s*0?\.\d+\s*\)/.test(value) || /\/\s*\d{1,2}%\s*\)/.test(value) || /(?:hsla|rgba)\([^)]*,\s*0?\.\d+\s*\)/.test(value) || /\btransparent\b/.test(value);

describe("every popup surface (.glass-modal) is opaque in both themes", () => {
  it("the inventory is real: the base rule, the dark rule and the reduced-transparency rules", () => {
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => r.selector === ".glass-modal")).toBe(true);
    expect(rules.some((r) => /data-theme="dark"\] \.glass-modal$/.test(r.selector))).toBe(true);
  });

  it("no rule paints it translucent", () => {
    const bad = rules
      .flatMap((r) => [...r.body.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g)].map((d) => ({ sel: r.selector, v: d[1].trim() })))
      .filter((d) => translucent(d.v))
      .map((d) => `${d.sel} { background: ${d.v} }`);
    expect(bad).toEqual([]);
  });

  it("no rule blurs what is behind it (an opaque card has nothing to blur)", () => {
    const blurred = rules.filter((r) => /backdrop-filter\s*:\s*(?!none)/.test(r.body)).map((r) => r.selector);
    expect(blurred).toEqual([]);
  });

  it("the shared Dialog and Sheet wear it", () => {
    for (const f of ["src/components/ui/dialog.tsx", "src/components/ui/sheet.tsx"]) {
      expect(blankComments(readFileSync(resolve(ROOT, f), "utf8")), f).toMatch(/"glass-modal /);
    }
  });
});
