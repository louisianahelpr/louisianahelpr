/**
 * POSTED / WORKING: THE OPEN SEARCH NEVER LEAVES A CUT TAB OR CHIP (audit 2026-10-28 F20; moved 2026-10-31).
 *
 * The bug (F20): on a phone the open search field sat at the end of the status chip row, and the chips kept what was
 * left (129px of scroller at 375, 80px at 320), so the field sat on a sliver of cut chips ("Ne", "Waitir").
 *
 * Then the owner moved the search (2026-10-31, Jobs > Posted at 375, LEAD-SEARCH-BY-GEAR: "move it up into the tab row
 * next to the gear"): the icon ends the TABS row before the gear, as Browse's does (owner 2026-10-28). The same rule as
 * Browse's now holds there: while the field is open on a phone the tabs row keeps ONLY the selected tab, whole
 * (SectionTabs `onlySelected`), and the field takes exactly the rest (`min-w-0 flex-1`). The status chip row has no
 * control at its end any more, so it keeps every chip and every count, open or closed. Desktop keeps every tab (its
 * 260px pill leaves room).
 *
 * @mutate src/components/job-card/embeddedActivity.tsx | header({ end: searchEnd, onlySelected: searchOpen && !desktop }) | header({ end: searchEnd, onlySelected: false })
 * @mutate src/components/job-card/embeddedActivity.tsx | header({ end: searchEnd, onlySelected: searchOpen && !desktop }) | header({ end: searchEnd, onlySelected: searchOpen })
 * @mutate src/components/job-card/embeddedActivity.tsx | ${searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"} | ${"-ml-1 shrink-0"}
 * @mutate src/components/sections/StatusBoxes.tsx | {boxes.map((b) => chip(b.key, | {boxes.filter((b) => b.key === value).map((b) => chip(b.key,
 * @mutate src/components/sections/StatusBoxes.tsx | {count > 0 && <span | {false && <span
 * @mutate src/components/sections/InlineListSearch.tsx | ${fill ? "search-fill min-w-0 flex-1 gap-1 pl-2" : "w-[clamp(200px,55vw,320px)] shrink-0 gap-1.5 pl-3"} | w-[clamp(200px,55vw,320px)] shrink-0 gap-1.5 pl-3
 * @mutate src/components/sections/InlineListSearch.tsx | ${fill && !desktop ? "search-fill-glyph" : ""} | ${""}
 * @mutate src/index.css | @container (max-width: 159px) {\n  .search-fill-glyph { display: none; } | @container (max-width: 99px) {\n  .search-fill-glyph { display: none; }
 * @mutate src/components/sections/InlineListSearch.tsx |     onOpenChangeRef.current?.(open);\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";

const env = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));

import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { SectionTabs } from "@/components/sections/SectionTabs";

afterEach(() => {
  cleanup();
  env.desktop = false;
});

const COUNTS = { all: 57, needs_you: 16, waiting: 3, scheduled: 1, done: 37, cancelled: 19 };
const TABS = [{ value: "posted", label: "Posted" }, { value: "working", label: "Working" }] as const;

/** JobsSection's makeHeader in small: the real tabs row, the tab's search handed in, then the gear. */
const header = (row?: { end?: ReactNode; onlySelected?: boolean }) => (
  <SectionTabs label="Jobs" tabs={TABS} value="working" onChange={() => {}} onlySelected={row?.onlySelected} end={<>{row?.end}<button type="button" aria-label="Jobs settings" data-testid="section-settings" /></>} />
);

function renderHeader(statusFilter = "all", search = "") {
  return render(
    <MemoryRouter>
      <EmbeddedActivityHeader header={header} tab="applied" statusFilter={statusFilter} counts={COUNTS} onFilter={() => {}} search={search} onSearch={() => {}} />
    </MemoryRouter>,
  );
}

const chips = () => within(screen.getByRole("group", { name: "Filter by status" })).getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
const tabs = () => screen.getAllByRole("tab").map((t) => (t.textContent ?? "").trim());
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Search jobs you're working" }));

describe("Posted / Working: the open search keeps only the selected tab on a phone, and every chip", () => {
  it("closed: every tab, every chip with its count, in a scroller with no end fade (nothing sits at its end)", () => {
    renderHeader();
    expect(tabs().length).toBeGreaterThan(2);
    // Inventory floor: All plus the five buckets.
    expect(chips().length).toBeGreaterThan(5);
    expect(chips()[0]).toBe("All · 57");
    const row = classes(screen.getByRole("group", { name: "Filter by status" }));
    expect(row).toContain("overflow-x-auto");
    expect(row.join(" ")).not.toMatch(/mask-image|pr-11/);
  });

  it("open: only the selected tab stays, whole; the field fills the rest of the tabs row; every chip and count stay", () => {
    renderHeader("waiting");
    open();
    expect(tabs()).toEqual(["Working"]);
    const field = screen.getByRole("search", { name: "Search jobs you're working" });
    expect(classes(field)).toEqual(expect.arrayContaining(["flex-1", "min-w-0"]));
    expect(classes(field).join(" ")).not.toMatch(/clamp\(200px/);
    const box = field.closest<HTMLElement>("[data-activity-search-controls]")!;
    expect(classes(box)).toEqual(expect.arrayContaining(["flex-1", "min-w-0"]));
    expect(screen.getByTestId("section-tabs").contains(field), "the field opens in the tabs row").toBe(true);
    expect(chips().length).toBeGreaterThan(5);
    expect(chips()).toContain("Waiting · 3");
    expect(screen.getByRole("button", { name: /Waiting/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("closing the field (Escape) brings every tab back", () => {
    renderHeader();
    open();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search jobs you're working" }), { key: "Escape" });
    expect(tabs().length).toBeGreaterThan(2);
    const box = document.querySelector("[data-activity-search-controls]")!;
    expect(classes(box)).toContain("shrink-0");
    expect(classes(box)).not.toContain("flex-1");
  });

  it("arriving with words in ?q= opens the field, and the tabs row already shows only the selected tab", () => {
    renderHeader("all", "AA5");
    expect(screen.getByRole("search", { name: "Search jobs you're working" })).toBeTruthy();
    expect(tabs()).toEqual(["Working"]);
  });

  it("desktop keeps every tab while the 260px pill is open", () => {
    env.desktop = true;
    renderHeader();
    open();
    expect(tabs().length).toBeGreaterThan(2);
    expect(chips().length).toBeGreaterThan(5);
  });

  it("a narrow filling field keeps its word: below 160px the decorative magnifier steps aside (index.css)", () => {
    renderHeader();
    open();
    const form = screen.getByRole("search", { name: "Search jobs you're working" });
    expect(classes(form)).toContain("search-fill");
    const glyph = form.querySelector("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(classes(glyph!)).toContain("search-fill-glyph");
    // Measured: "Not picked · 19" lit at 320 leaves the field 138px, where the word read "Searc" beside the glyph.
    const css = blankCssComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));
    expect(css).toMatch(/\.search-fill\s*\{\s*container-type:\s*inline-size;\s*\}/);
    expect(css).toMatch(/@container \(max-width: 159px\) \{\s*\.search-fill-glyph \{ display: none; \}/);
  });
});
