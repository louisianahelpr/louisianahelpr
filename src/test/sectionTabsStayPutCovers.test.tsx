/**
 * Owner bug 2026-10-30 (iPhone Safari): the section tab row's words vanished when the page scrolled, because the
 * tablist was a vertical scroller too (overflow-x:auto -> overflow-y:auto, and a 1px underline overhang).
 *   1. Every file that renders <SectionTabs> is listed in e2e/a11y-prod/sectionTabScreens.ts, so the WebKit scroll
 *      check (e2e/a11y-prod/sectionTabsStayPut.spec.ts) opens it. Inventory from source, exact both ways.
 *   2. The tablist is a sideways-only scroller: overflow-x auto AND overflow-y hidden (jsdom has no layout, so the
 *      class is what is held here; the spec measures the real row).
 *
 * @mutate src/components/sections/SectionTabs.tsx | items-end overflow-x-auto overflow-y-hidden no-scrollbar | items-end overflow-x-auto no-scrollbar
 * @mutate e2e/a11y-prod/sectionTabScreens.ts |   { name: "Homes", file: "src/components/rentals/RentalsHomeView.tsx", path: "/rentals" },\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { SectionTabs } from "@/components/sections/SectionTabs";
import { SECTION_TAB_SCREENS } from "../../e2e/a11y-prod/sectionTabScreens";

const ROOT = resolve(__dirname, "../..");

describe("section tab rows never scroll vertically, and every one is checked scrolled", () => {
  const users = walkSource([join(ROOT, "src")], [".tsx"])
    .filter((f) => !/\.test\.tsx$/.test(f))
    .filter((f) => /<SectionTabs\b/.test(blankComments(readFileSync(f, "utf8"))))
    .map((f) => relative(ROOT, f))
    .sort();

  it("the inventory read something", () => {
    expect(users.length).toBeGreaterThan(3);
  });

  it("every <SectionTabs> screen is in the WebKit scroll check, and nothing else is", () => {
    expect(SECTION_TAB_SCREENS.map((s) => s.file).sort()).toEqual(users);
  });

  it("the tablist scrolls sideways only", () => {
    render(<SectionTabs label="Declutter view" tabs={[{ value: "buying", label: "Buying" }]} value="buying" onChange={() => {}} />);
    const cls = screen.getByRole("tablist").className;
    expect(cls).toMatch(/\boverflow-x-auto\b/);
    expect(cls).toMatch(/\boverflow-y-hidden\b/);
  });
});
