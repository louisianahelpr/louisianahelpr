/**
 * Deep audit 11-22 #30 (Medium): at 1440 the Jobs Filters pop-up showed about half its options (capped at 36rem with
 * ~780px free), and the cut fell neatly between category chips, so "Show only" and Saved searches could not be found
 * without scrolling blind. The pop-up may now use 45rem of the room under the button, and while more is below its
 * body's last 40px fade out.
 *
 * CLASS: FilterDropdown is the one desktop filter pop-up (Jobs and Declutter, filterDropdownOnDesktop.test.tsx).
 *
 * @mutate src/components/dashboard/filterSheet/FilterDropdown.tsx | const FILTER_DROPDOWN_MAX_HEIGHT = "min(45rem, | const FILTER_DROPDOWN_MAX_HEIGHT = "min(36rem,
 * @mutate src/components/dashboard/filterSheet/FilterDropdown.tsx |     if (body) setMoreBelow(body.scrollHeight - body.scrollTop - body.clientHeight > 2); |     if (body) setMoreBelow(false);
 * @mutate src/components/dashboard/filterSheet/FilterDropdown.tsx | ${moreBelow ? ` ${MORE_BELOW_FADE}` : ""} | 
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync("src/components/dashboard/filterSheet/FilterDropdown.tsx", "utf8"));

describe("the desktop Filters pop-up shows more and says when there is more (deep audit 11-22 #30)", () => {
  it("reads the real pop-up (not vacuous)", () => {
    expect(src).toMatch(/<PopoverContent\b/);
    expect(src).toMatch(/data-filter-sheet-body=""/);
  });

  it("uses up to 45rem of the room Radix measures, never the old 36rem cap", () => {
    expect(src).toContain('const FILTER_DROPDOWN_MAX_HEIGHT = "min(45rem, calc(var(--radix-popover-content-available-height, 80vh) - 16px))";');
    expect(src).toContain("maxHeight: FILTER_DROPDOWN_MAX_HEIGHT,");
    expect(src).not.toContain("36rem");
  });

  it("fades the body's bottom edge while more is below, measured on scroll and resize", () => {
    expect(src).toContain('const MORE_BELOW_FADE = "[mask-image:linear-gradient(to_bottom,#000_calc(100%-40px),transparent)]";');
    expect(src).toContain("setMoreBelow(body.scrollHeight - body.scrollTop - body.clientHeight > 2)");
    expect(src).toMatch(/addEventListener\("scroll", measure/);
    expect(src).toMatch(/new ResizeObserver\(measure\)/);
    expect(src).toContain('data-more-below={moreBelow ? "" : undefined}');
    expect(src).toContain('${moreBelow ? ` ${MORE_BELOW_FADE}` : ""}');
  });
});
