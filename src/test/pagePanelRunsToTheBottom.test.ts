/**
 * CLASS CHECK: the page panel must never be re-curved or re-bordered along
 * its BOTTOM edge. It runs to the bottom of the viewport, the way the right
 * rail does.
 *
 * Owner, 2026-09-16: "the panels must not be curved on the bottom — they
 * should run to the bottom like the right rail." That reverses the 2026-09-07
 * decision that added `html.web-desktop .page-panel { border-bottom-*-radius:
 * 1.5rem !important; border-bottom: 1px solid … !important }` to src/index.css.
 *
 * The flat shape is the DEFAULT: `panelSurfaceStyle` (pageCardSurfaces.ts)
 * sets bottom radii 0 and `borderBottom: none` inline, and `.page-panel`
 * (PageScaffold.tsx PANEL_CLASS) exists purely as a stylesheet hook that an
 * `!important` rule can use to beat those inline styles. So the only way the
 * curve comes back is a `.page-panel` rule in the global stylesheet — which is
 * exactly what this guards. It covers Home (/dashboard), My Posts, My Jobs,
 * both Messages panes and the guest dashboard in one assertion, because all
 * six render through the single PageScaffold that owns the class.
 *
 * WHY A SOURCE GUARD AND NOT A COMPUTED-STYLE TEST: jsdom does not load
 * src/index.css and does not implement the cascade for `!important` stylesheet
 * rules over inline styles, so `getComputedStyle(panel).borderBottomLeftRadius`
 * in a render test would read the inline `0` and pass no matter what the
 * stylesheet says — a check that cannot fail is worse than no check. Parsing
 * the stylesheet the app actually ships is the honest option, and it is the
 * pattern already used by rootPaddingVsAppShellFrame.test.ts.
 *
 * Shown able to fail: restoring the deleted rule turns this red, naming the
 * selector and each offending declaration.
 *
 * TWO doors, so two registrations. The stylesheet is one; the INLINE default
 * is the other. `panelSurfaceStyle` is what actually flattens the bottom edge
 * at every width, and a one-word edit there re-curves all six panels without
 * touching src/index.css at all — which the CSS scan above cannot see. The
 * second block asserts that default directly.
 */
// @mutate src/index.css |   html.web-desktop .mobile-nav-frame { |   html.web-desktop .page-panel { border-bottom-left-radius: 1.5rem !important; }  html.web-desktop .mobile-nav-frame {
// @mutate src/components/ui/pageCardSurfaces.ts |   borderBottomLeftRadius: 0,\n  borderBottomRightRadius: 0,\n  borderBottom: "none", |   borderBottomLeftRadius: "1.5rem",\n  borderBottomRightRadius: "1.5rem",\n  borderBottom: "1px solid hsl(var(--border))",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { panelSurfaceStyle } from "@/components/ui/pageCardSurfaces";

const CSS_PATH = path.resolve(__dirname, "../index.css");

// Anything that would put a curve or a line back on the panel's bottom edge.
const BOTTOM_RADIUS_PROPS = new Set([
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-end-start-radius",
  "border-end-end-radius",
]);
const BOTTOM_BORDER_PROPS = new Set([
  "border-bottom",
  "border-bottom-width",
  "border-bottom-style",
  "border-bottom-color",
  "border-block-end",
  "border-block-end-width",
]);

const isZeroish = (v: string) =>
  /^(0(px|rem|em|%)?\s*)+$/.test(v.trim()) ||
  /^(none|0|unset|initial|revert)$/.test(v.trim().toLowerCase());

/** `border-radius: a b c d` — the bottom corners are the 3rd and 4th values. */
function shorthandRoundsBottom(value: string): boolean {
  const parts = value.split("/")[0].trim().split(/\s+/);
  if (parts.length === 0) return false;
  const [tl, tr = tl, br = tl, bl = tr] = parts;
  void tl;
  void tr;
  return !isZeroish(br) || !isZeroish(bl);
}

function offenders(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const selectors = rule.selectors.filter((s) => /\.page-panel\b/.test(s));
    if (selectors.length === 0) return;
    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      const value = decl.value.trim();
      const hit =
        (BOTTOM_RADIUS_PROPS.has(prop) && !isZeroish(value)) ||
        (BOTTOM_BORDER_PROPS.has(prop) && !isZeroish(value)) ||
        (prop === "border-radius" && shorthandRoundsBottom(value)) ||
        (prop === "border" && !isZeroish(value));
      if (hit) {
        found.push(`${selectors.join(", ")} { ${decl.prop}: ${decl.value} }`);
      }
    });
  });
  return found;
}

describe("the page panel runs to the bottom, like the right rail", () => {
  it("no rule in src/index.css re-curves or re-borders .page-panel's bottom edge", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    expect(offenders(css)).toEqual([]);
  });

  it("panelSurfaceStyle — the inline default — keeps the bottom edge flat", () => {
    // The stylesheet scan above only sees an `!important` OVERRIDE. This is
    // the value being overridden, and the one that governs at every width.
    for (const elevation of ["raised", "flat"] as const) {
      const style = panelSurfaceStyle(elevation);
      expect(style.borderBottomLeftRadius, elevation).toBe(0);
      expect(style.borderBottomRightRadius, elevation).toBe(0);
      expect(style.borderBottom, elevation).toBe("none");
    }
  });

  it("the guard can see an offending rule (it is not vacuous)", () => {
    const reintroduced = `
      html.web-desktop .page-panel {
        border-bottom-left-radius: 1.5rem !important;
        border-bottom-right-radius: 1.5rem !important;
        border-bottom: 1px solid hsl(var(--border)) !important;
      }
    `;
    expect(offenders(reintroduced)).toHaveLength(3);
    // The `border-radius` shorthand is a second door into the same defect.
    expect(offenders(".page-panel { border-radius: 1.5rem; }")).toHaveLength(1);
    // …and a flat bottom stated explicitly is still fine.
    expect(
      offenders(".page-panel { border-bottom-left-radius: 0; border-bottom: none; }"),
    ).toEqual([]);
  });
});
