/**
 * A3-6 (Declutter audit 3, 2026-10-28): Declutter's five tabs (Browse Buying Selling Deliver Wanted) were 362px of
 * row in a 280 / 335 / 350px track at 320 / 375 / 390 (WebKit, measured), so the last tab read "Wante" at the scroll
 * edge. A row of five or more tabs is now `dense` on a phone: words sized by the screen's width, 12px apart. After:
 * scrollWidth == clientWidth at all three widths (~/.lh-shots/b3-1028/a3-6). jsdom has no layout, so this holds the
 * two halves that produce the fit: the row takes the class, and the stylesheet sizes it.
 *
 * @mutate src/components/sections/SectionTabs.tsx |   const dense = options.length >= DENSE_TAB_COUNT; |   const dense = false;
 * @mutate src/index.css |     font-size: clamp(12px, 3.6vw, 15px); |     font-size: 15px;
 * @mutate src/components/sections/SectionTabs.tsx | dense ? "gap-3 min-[420px]:gap-5" : "gap-5" | "gap-5"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { SectionTabs, DENSE_TAB_COUNT } from "@/components/sections/SectionTabs";

const five = [
  { value: "buying", label: "Buying" },
  { value: "selling", label: "Selling" },
  { value: "deliver", label: "Deliver" },
  { value: "wanted", label: "Wanted" },
] as const;

describe("five section tabs fit a phone (A3-6)", () => {
  it("Declutter's row (Browse + four) is dense and 12px apart", () => {
    expect(DENSE_TAB_COUNT).toBe(5);
    render(<SectionTabs label="Declutter view" tabs={five} value="selling" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/\bsection-tabs-dense\b/);
    expect(list.className).toMatch(/\bgap-3\b/);
  });

  it("Jobs' three tabs keep their size", () => {
    render(<SectionTabs label="Jobs view" tabs={five.slice(0, 2)} value="buying" onChange={() => {}} />);
    expect(screen.getByRole("tablist").className).not.toMatch(/section-tabs-dense/);
  });

  it("the stylesheet sizes a dense row's words by the screen below 420px, never over 15px", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
    const at = css.indexOf(".section-tabs-dense .section-tab");
    expect(at).toBeGreaterThan(0);
    expect(css.slice(Math.max(0, at - 80), at)).toMatch(/@media \(max-width: 419px\) \{\s*$/);
    expect(css.slice(at, at + 120)).toMatch(/font-size: clamp\(12px, 3\.6vw, 15px\);/);
  });
});
