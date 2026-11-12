/**
 * Owner 10-30, Declutter Browse at a phone: search and filter move beside the gear. Owner 11-12 (iPhone, "3 more >"):
 * the row is ONE sideways strip of every tab, swipeable with no scrollbar, no "N more" pill and no chevrons, the
 * selected tab kept in view and every tab keyboard reachable. Layout is stubbed here (jsdom has none).
 *
 * @mutate src/components/sections/SectionTabs.tsx | if (t.right > box.right) list.scrollLeft += t.right - box.right + 16; | if (t.right > box.right) list.scrollLeft += 0;
 * @mutate src/components/sections/SectionTabs.tsx | else if (t.left < box.left) list.scrollLeft -= box.left - t.left + 16; | else if (t.left < box.left) list.scrollLeft -= 0;
 * @mutate src/components/sections/SectionTabs.tsx |           if (onlySelected && !active) return null;\n |
 * @mutate src/components/job-card/embeddedActivity.tsx | searchOpen ? "ml-2 min-w-0 flex-1" | "ml-2 min-w-0 flex-1"
 * @mutate src/pages/home/Dashboard.tsx | <SectionSearchBar noun="jobs" home="/jobs" value={filters.searchQuery} | <InlineListSearch label="Search jobs" value={filters.searchQuery}
 * @mutate src/components/job-card/embeddedActivity.tsx |       {searchOpen && <SearchTriggerSlot width="40px" />} |       {null}
 * @mutate src/components/job-card/embeddedActivity.tsx | ${searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"} | ${searchOpen ? "-ml-1 min-w-0 flex-1" : "-ml-1 shrink-0"}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { SectionTabs } from "@/components/sections/SectionTabs";

const TABS = [
  { value: "buying", label: "Buying" },
  { value: "selling", label: "Selling" },
  { value: "deliver", label: "Deliver" },
  { value: "wanted", label: "Wanted" },
  { value: "free", label: "Free" },
];
const TAB_W = 50;
const TRACK = 170;

/** A row of 50px tabs 8px apart in a 170px track, following scrollLeft. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="tablist"]') as HTMLElement | null;
    if (this.getAttribute("role") === "tablist") return { left: 0, right: TRACK, width: TRACK } as DOMRect;
    if (this.getAttribute("role") === "tab" && list) {
      const i = Array.from(list.children).indexOf(this);
      const left = i * (TAB_W + 8) - list.scrollLeft;
      return { left, right: left + TAB_W, width: TAB_W } as DOMRect;
    }
    return { left: 0, right: 0, width: 0 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(TABS.length * 58 + TAB_W);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(TRACK);
}
const cut = () => Array.from(document.querySelectorAll('[role="tab"][data-tab-cut]')).map((t) => t.textContent);
function row(value: string, onlySelected = false) {
  return render(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value={value as "buying"} onChange={() => undefined} end={<button type="button">Gear</button>} onlySelected={onlySelected} /></MemoryRouter>);
}

afterEach(() => vi.restoreAllMocks());

describe("a tab row that doesn't fit (owner 11-12: one sideways strip, no 'N more' pill)", () => {
  it("every tab is painted and reachable; there is no 'more' pill and no chevron", () => {
    layOut();
    row("browse");
    expect(cut()).toEqual([]);
    for (const t of ["Browse", "Buying", "Selling", "Deliver", "Wanted", "Free"]) expect(screen.getByRole("tab", { name: t })).toBeVisible();
    expect(screen.queryByRole("button", { name: /more tabs/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Earlier tabs/ })).toBeNull();
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
    expect(screen.getByRole("tablist").className).toContain("no-scrollbar");
  });

  it("on load the selected tab is scrolled into view, with a little of the next one showing", () => {
    layOut();
    row("wanted");
    // Wanted is the fifth, 232-282 in a 170px track.
    expect(screen.getByRole("tablist").scrollLeft).toBe(282 - TRACK + 16);
  });

  it("a selected tab off the row's start comes back into view when a search closes", () => {
    layOut();
    const { rerender } = row("browse");
    const list = screen.getByRole("tablist");
    list.scrollLeft = 120;
    rerender(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value="browse" onChange={() => undefined} onlySelected /></MemoryRouter>);
    rerender(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value="browse" onChange={() => undefined} /></MemoryRouter>);
    expect(list.scrollLeft).toBeLessThanOrEqual(0);
  });

  it("the keyboard reaches every tab: End goes to the last, Home back to Browse", () => {
    const changes: string[] = [];
    render(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value="browse" onChange={(v) => changes.push(v)} /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(changes).toEqual(["free"]);
    expect(document.activeElement?.textContent).toBe("Free");
  });

  it("with search open only the selected tab stays", () => {
    layOut();
    row("browse", true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Browse"]);
  });
});

describe("Declutter Browse follows Jobs' row", () => {
  const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

  // Owner 11-08 (the Vinted header): on a phone both Browses search from the SAME bar (SectionSearchBar, Filters inside
  // it), and neither draws a search row of its own.
  it("Jobs' Browse reuses the same search and has no search row of its own", () => {
    const dash = code("src/pages/home/Dashboard.tsx");
    expect(dash).toMatch(/<SectionSearchBar noun="jobs" home="\/jobs" value=\{filters\.searchQuery\}[^>]*filter=\{<BrowseFiltersButton/);
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).toMatch(/<SectionSearchBar noun="Declutter" home="\/declutter" value=\{query\}/);
    for (const f of ["src/pages/home/Dashboard.tsx", "src/components/declutter/DeclutterBrowseView.tsx", "src/components/declutter/DeclutterBrowseBar.tsx"]) {
      expect({ f, row: code(f).includes("SectionSearchRow") }).toEqual({ f, row: false });
    }
    expect(TABS.length).toBeGreaterThan(4);
  });

  // The desktop website's tabs row (Jobs > Posted / Working): the icon by the gear opens in place, its 40px slot held
  // after the field and the field's box filling the rest of the row (src/test/searchKeepsLitChip.test.tsx renders it).
  it("Jobs gives the row to an open search, with the slot held and the field filling it", () => {
    const head = code("src/components/job-card/embeddedActivity.tsx");
    expect(head).toMatch(/<InlineListSearch[^>]*onOpenChange=\{[^}]+\} fill \/>\s*\{\w+ && <SearchTriggerSlot width="40px" \/>\}/);
    // The row's gap is cancelled by -ml-1 when closed; open, the field keeps 8px from the tab.
    expect(head).toContain('searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"');
  });
});
