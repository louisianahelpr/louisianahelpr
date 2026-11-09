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
 * Then the Vinted header (owner 11-08): on a phone the tab's search left the tabs row for the top bar's own rounded
 * field (SectionSearchBar), and the tabs row left the phone ("My Jobs" under the photo). So on a phone typing never
 * takes room from a tab or a chip: every chip and count stay, open or not. The tabs-row rules above hold on the desktop
 * website, where the icon by the gear still opens in place.
 *
 * HELP-WORKIN (lead 10-31): with counts at 360 the 4th chip ("Booked") starts just past the edge with no cue that the
 * row scrolls. The row now carries Declutter's right-edge fade (AUD31-4): a mask over the last 40px and an end padding
 * at least as wide, so the last chip scrolls clear of it.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |             fade\n          /> |           />
 * @mutate src/components/sections/StatusBoxes.tsx | : fade ? "pl-1 pr-10 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]" : "px-1" | : "px-1"
 *
 * @mutate src/components/job-card/embeddedActivity.tsx | header(desktop ? { end: searchEnd } : { search: <SectionSearchBar | header(desktop \|\| true ? { end: searchEnd } : { search: <SectionSearchBar
 * @mutate src/components/job-card/embeddedActivity.tsx | home="/jobs" value={search} onChange={onSearch} /> }) | home="/jobs" value={search} onChange={onSearch} />, end: searchEnd })
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
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";

const env = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));

import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { SectionTabs } from "@/components/sections/SectionTabs";
import { InlineListSearch } from "@/components/sections/InlineListSearch";

afterEach(() => {
  cleanup();
  env.desktop = false;
});

// F107 (owner 11-09): Working's chips are Needs you · Applied · Active · Completed.
const COUNTS = { all: 57, needs_you: 16, applied: 2, active: 3, completed: 37, waiting: 3, scheduled: 1, done: 37, cancelled: 19 };
const TABS = [{ value: "posted", label: "Posted" }, { value: "working", label: "Working" }] as const;

/**
 * JobsSection's makeHeader in small: the bar (a phone's search field) and the real tabs row (the desktop website's),
 * the tab's search icon handed in, then the gear.
 */
const header = (row?: { end?: ReactNode; search?: ReactNode }) => (
  <>
    <header data-testid="app-top-bar">{row?.search}</header>
    <SectionTabs label="Jobs" tabs={TABS} value="working" onChange={() => {}} end={<>{row?.end}<button type="button" aria-label="Jobs settings" data-testid="section-settings" /></>} />
  </>
);

function Header({ statusFilter, initial }: { statusFilter: string; initial: string }) {
  const [q, setQ] = useState(initial);
  return <EmbeddedActivityHeader header={header} tab="applied" statusFilter={statusFilter} counts={COUNTS} onFilter={() => {}} search={q} onSearch={setQ} />;
}

function renderHeader(statusFilter = "all", search = "") {
  return render(
    <MemoryRouter>
      <Header statusFilter={statusFilter} initial={search} />
    </MemoryRouter>,
  );
}

const chips = () => within(screen.getByRole("group", { name: "Filter by status" })).getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
const tabs = () => screen.getAllByRole("tab").map((t) => (t.textContent ?? "").trim());
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Search jobs you're working" }));

describe("Posted / Working: the open search never cuts a tab or a chip", () => {
  it("closed: every tab, every chip with its count, in a scroller whose right edge fades (HELP-WORKIN, Declutter's AUD31-4)", () => {
    renderHeader();
    expect(tabs().length).toBeGreaterThan(2);
    // Inventory floor: All plus Working's four chips (F107).
    expect(chips().length).toBeGreaterThan(4);
    expect(chips()[0]).toBe("All · 57");
    const row = classes(screen.getByRole("group", { name: "Filter by status" }));
    expect(row).toContain("overflow-x-auto");
    expect(row).not.toContain("flex-wrap");
    const fade = row.map((c) => /^\[mask-image:linear-gradient\(to_right,#000_calc\(100%-(\d+)px\),transparent\)\]$/.exec(c)).find(Boolean);
    expect(fade, "a right-edge fade on the chip row").toBeTruthy();
    const fadePx = Number(fade![1]);
    expect(fadePx).toBeGreaterThanOrEqual(24);
    const pr = row.map((c) => /^pr-(\d+)$/.exec(c)).find(Boolean);
    expect(pr, "an end padding on the chip row").toBeTruthy();
    expect(Number(pr![1]) * 4, "end padding >= the fade, so the last chip scrolls clear of it").toBeGreaterThanOrEqual(fadePx);
  });

  it("phone: typing in the bar's field keeps every chip and count, the lit one lit; the field is the bar's, never in the tabs or chip row", () => {
    renderHeader("active");
    const field = screen.getByRole("search", { name: "Search jobs you're working" });
    expect(screen.getByTestId("app-top-bar").contains(field), "the bar's field").toBe(true);
    expect(screen.getByTestId("section-tabs").contains(field)).toBe(false);
    expect(document.querySelector("[data-jobs-toolbar]")!.contains(field)).toBe(false);
    expect(screen.queryByRole("button", { name: "Search jobs you're working" }), "no icon to open").toBeNull();
    fireEvent.change(within(field).getByRole("searchbox"), { target: { value: "mow" } });
    expect(chips().length).toBeGreaterThan(4);
    expect(chips()).toContain("Active · 3");
    expect(screen.getByRole("button", { name: /Active/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("phone: Escape in the bar's field clears its words; every chip stays", () => {
    renderHeader("all", "mow");
    const box = screen.getByRole("searchbox", { name: "Search jobs you're working" }) as HTMLInputElement;
    expect(box.value).toBe("mow");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    expect(chips().length).toBeGreaterThan(4);
  });

  it("phone: arriving with words in ?q= shows them in the bar's field, with every chip", () => {
    renderHeader("all", "AA5");
    expect((screen.getByRole("searchbox", { name: "Search jobs you're working" }) as HTMLInputElement).value).toBe("AA5");
    expect(chips().length).toBeGreaterThan(4);
  });

  it("desktop keeps every tab while the 260px pill is open; the open field's box fills the row and closes back to the icon's size", () => {
    env.desktop = true;
    renderHeader();
    open();
    expect(tabs().length).toBeGreaterThan(2);
    expect(chips().length).toBeGreaterThan(4);
    const field = screen.getByRole("search", { name: "Search jobs you're working" });
    expect(screen.getByTestId("section-tabs").contains(field), "the field opens in the tabs row").toBe(true);
    const box = field.closest<HTMLElement>("[data-activity-search-controls]")!;
    expect(classes(box)).toEqual(expect.arrayContaining(["flex-1", "min-w-0"]));
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search jobs you're working" }), { key: "Escape" });
    expect(classes(document.querySelector("[data-activity-search-controls]")!)).toContain("shrink-0");
    expect(classes(document.querySelector("[data-activity-search-controls]")!)).not.toContain("flex-1");
  });

  // InlineListSearch's own rule for a filling field on a phone (no Jobs tab hands it one since owner 11-08; the bar's
  // field drops its noun below 360px instead, SectionSearchBar).
  it("a narrow filling field keeps its word: below 160px the decorative magnifier steps aside (index.css)", () => {
    render(<InlineListSearch value="" onChange={() => {}} label="Search jobs you're working" fill />);
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
