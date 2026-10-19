/**
 * Two breakpoints live twice: as a named constant (the number a reader and a
 * spec can import) and as LITERAL Tailwind classes in the component, because
 * a class built from the constant compiles to no rule at all (Tailwind scans
 * source text). This guard holds the two copies together, so moving one
 * without the other fails here instead of silently swapping words or wrapping
 * the search field at the wrong width. (Until 2026-10-19 the old
 * activityTabLabelsFitAPhone budget read both constants; the section rewrite
 * dropped those screens.)
 *
 * @mutate src/lib/shortLabelBreakpoint.ts | export const SHORT_LABEL_BELOW_PX = 390; | export const SHORT_LABEL_BELOW_PX = 290;
 * @mutate src/components/ui/ScreenHeaderRow.tsx | export const NARROW_TITLE_ASIDE_PX = 500; | export const NARROW_TITLE_ASIDE_PX = 600;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHORT_LABEL_BELOW_PX } from "@/components/ui/UnderlineTabs";
import { NARROW_TITLE_ASIDE_PX } from "@/components/ui/ScreenHeaderRow";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
// Built from parts, never written as `min-` + bracket + interpolation in one token: Tailwind scans
// tests too, and one such candidate silently disables every arbitrary width variant in the app
// (src/test/arbitraryWidthVariantsCompile.test.ts).
const BR = "[";
const cls = (prefix: "min" | "max", px: number, util: string) => `${prefix}-${BR}${px}px]:${util}`;

describe("breakpoint constants match the literal classes that implement them", () => {
  it("UnderlineTabs swaps to the short label below SHORT_LABEL_BELOW_PX", () => {
    const src = code("src/components/ui/UnderlineTabs.tsx");
    expect(SHORT_LABEL_BELOW_PX).toBeGreaterThan(300);
    expect(src).toContain(cls("min", SHORT_LABEL_BELOW_PX, "hidden"));
    expect(src).toContain(cls("min", SHORT_LABEL_BELOW_PX, "inline"));
  });

  it("ScreenHeaderRow wraps the search field onto its own line below NARROW_TITLE_ASIDE_PX", () => {
    const src = code("src/components/ui/ScreenHeaderRow.tsx");
    expect(NARROW_TITLE_ASIDE_PX).toBeGreaterThan(400);
    expect(src).toContain(cls("max", NARROW_TITLE_ASIDE_PX - 1, "flex-wrap"));
    expect(src).toContain(cls("max", NARROW_TITLE_ASIDE_PX - 1, "basis-full"));
  });
});
