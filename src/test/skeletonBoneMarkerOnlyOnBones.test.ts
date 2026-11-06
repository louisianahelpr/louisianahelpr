/**
 * CLASS GUARD: `data-skeleton` is the BONE marker, and only a bone wears it.
 *
 * WHY. src/index.css paints every `[data-skeleton]` grey (`background-color:
 * hsl(220 12% 91%) !important`, the T5 shimmer) because the shared Skeleton
 * bone (src/components/ui/skeleton.tsx) sets `data-skeleton=""`. On 2026-10-19
 * DashboardRouteSkeleton used the same attribute to NAME its regions
 * (`data-skeleton="next-up"`, `"coming-up"`, `"tiles"`), so the rule painted
 * the white liquid-glass "Next up" and "Coming up" cards and the 2x2 tile grid
 * solid grey: every phone opening /home saw three grey blocks for ~2.4 s
 * (the HTML shell, Q2705 B) and again in React's route fallback. Measured on a
 * local render at 375: the tile grid's computed background was rgb(229, 231,
 * 235). A region marker is `data-skeleton-part`.
 *
 * HOW. Inventory from source: every git-tracked .tsx under src/ plus
 * index.html (the HTML shells), comments blanked. Any `data-skeleton` attribute
 * whose value is not empty (JSX `data-skeleton="x"` / `data-skeleton={...}`,
 * HTML `data-skeleton="x"`) is an offender.
 *
 * @mutate src/components/DashboardRouteSkeleton.tsx | data-skeleton-part="tiles" | data-skeleton="tiles"
 * @mutate index.html | data-skeleton-part="coming-up" | data-skeleton="coming-up"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const BONE_ATTR = /\bdata-skeleton(?![-\w])\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/g;

function offenders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(BONE_ATTR)) {
    const v = m[1];
    if (v === '""' || v === "''" || v === '{""}' || v === "{''}") continue;
    out.push(m[0]);
  }
  return out;
}

describe("data-skeleton marks bones only (regions use data-skeleton-part)", () => {
  const files = trackedFiles("src").filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f));

  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(500);
    const bones = files.filter((f) => /\bdata-skeleton\s*=\s*""/.test(readFileSync(f, "utf8")));
    expect(bones).toContain("src/components/ui/skeleton.tsx");
  });

  it("no component gives data-skeleton a value", () => {
    const bad = files.flatMap((f) => offenders(blankComments(readFileSync(f, "utf8"))).map((o) => `${f}: ${o}`));
    expect(bad).toEqual([]);
  });

  it("no HTML shell in index.html gives data-skeleton a value", () => {
    const html = readFileSync("index.html", "utf8").replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
    expect(html).toContain('id="lh-home-shell"');
    expect(offenders(html)).toEqual([]);
  });

  it("the detector sees the 10-19 shape", () => {
    expect(offenders('<div className="grid" data-skeleton="tiles">')).toEqual(['data-skeleton="tiles"']);
    expect(offenders('<div data-skeleton="" />')).toEqual([]);
    expect(offenders('<div data-skeleton-part="tiles">')).toEqual([]);
  });
});
