/**
 * Owner 10-30, Declutter Browse at a phone: search and filter move beside the gear, and "Wanted" was clipped. A tab row
 * that doesn't fit never shows a cut word: a tab the edge would cut waits unpainted, every tab stays reachable, and the
 * chevron brings the next one in. Layout is stubbed here (jsdom has none); the tester's screens at 360 and 375 are the proof of fit.
 *
 * @mutate src/components/sections/SectionTabs.tsx |         tab.toggleAttribute("data-tab-cut", cut && (tab !== selected \|\| memberMoved.current));\n |
 * @mutate src/components/sections/SectionTabs.tsx | cut && (tab !== selected \|\| memberMoved.current) | cut && tab !== selected
 * @mutate src/components/sections/SectionTabs.tsx | if (t.right > box.right) list.scrollLeft += t.right - box.right; | if (t.right > box.right) list.scrollLeft += 0;
 * @mutate src/components/sections/SectionTabs.tsx | else if (t.left < box.left) list.scrollLeft -= box.left - t.left; | else if (t.left < box.left) list.scrollLeft -= 0;
 * @mutate src/components/sections/SectionTabs.tsx |     memberMoved.current = true;\n    const edge = list.getBoundingClientRect().right; |     const edge = list.getBoundingClientRect().right;
 * @mutate src/components/sections/SectionTabs.tsx | if (next) list.scrollLeft += next.getBoundingClientRect().right - edge; | if (next) list.scrollLeft += 0;
 * @mutate src/components/sections/SectionTabs.tsx |           if (onlySelected && !active) return null;\n |
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         onlySelected: searchOpen,\n |
 * @mutate src/pages/home/Dashboard.tsx | { end: phoneBrowseEnd, onlySelected: phoneSearchOpen } | { end: phoneBrowseEnd }
 * @mutate src/pages/jobs/JobsSection.tsx | onlySelected={browse?.onlySelected} |
 * T12: the way back, and room between the tab and an open search.
 * @mutate src/components/sections/SectionTabs.tsx | {less && !onlySelected && ( | {false && (
 * @mutate src/components/sections/SectionTabs.tsx | list.scrollLeft = previous ? list.scrollLeft - (edge - previous.getBoundingClientRect().left) : 0; | list.scrollLeft = list.scrollLeft;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | ${searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"} | ${searchOpen ? "-ml-1 min-w-0 flex-1" : "-ml-1 shrink-0"}
 * @mutate src/pages/home/Dashboard.tsx | ${phoneSearchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"} | ${phoneSearchOpen ? "-ml-1 min-w-0 flex-1" : "-ml-1 shrink-0"}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

describe("a tab row that doesn't fit", () => {
  it("hides a tab the edge would cut, and only that one is hidden while the words beside it stay whole", () => {
    layOut();
    row("browse");
    // 0-50, 58-108, 116-166 fit; the fourth (174-224) is past the edge, and so on.
    expect(cut()).toEqual(["Deliver", "Wanted", "Free"]);
    expect(screen.getByRole("tablist").hasAttribute("data-tabs-more")).toBe(true);
  });

  it("every tab can be reached: the chevron brings the next one in whole, and scrolling re-reads which are cut", () => {
    layOut();
    row("selling");
    const list = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "More tabs" }));
    expect(list.scrollLeft).toBe(174 + TAB_W - TRACK);
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(cut()).not.toContain("Deliver");
    expect(cut()).toContain("Browse");
    for (const t of ["Browse", "Buying", "Selling", "Deliver", "Wanted", "Free"]) expect(screen.getByRole("tab", { name: t, hidden: true })).toBeInTheDocument();
  });

  it("on load the selected tab is scrolled whole, never left cut at the edge", () => {
    layOut();
    row("wanted");
    // Wanted is the fifth, 232-282 in a 170px track.
    expect(screen.getByRole("tablist").scrollLeft).toBe(282 - TRACK);
    expect(cut()).not.toContain("Wanted");
  });

  it("a selected tab off the row's start comes back whole when a search closes", () => {
    layOut();
    const { rerender } = row("browse");
    const list = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "More tabs" }));
    expect(list.scrollLeft).toBeGreaterThan(0);
    rerender(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value="browse" onChange={() => undefined} onlySelected /></MemoryRouter>);
    rerender(<MemoryRouter><SectionTabs label="Declutter view" tabs={TABS} value="browse" onChange={() => undefined} /></MemoryRouter>);
    expect(list.scrollLeft).toBe(0);
    expect(cut()).not.toContain("Browse");
  });

  it("after the chevron the selected tab is whole or not painted: never a lone letter", () => {
    layOut();
    row("browse");
    const list = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "More tabs" }));
    act(() => { list.dispatchEvent(new Event("scroll")); });
    // Browse is at -54..-4: the chevron moved it off, and the row does not pull it back.
    expect(list.scrollLeft).toBe(54);
    expect(cut()).toContain("Browse");
    // Swiping too: a partly hidden selected tab isn't painted.
    fireEvent.pointerDown(list);
    list.scrollLeft = 20;
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(list.scrollLeft).toBe(20);
    expect(cut()).toContain("Browse");
  });

  it("moved along, a left chevron brings back the tab before the edge, whole, and the selected one with it; none at the start", () => {
    layOut();
    row("browse");
    const list = screen.getByRole("tablist");
    expect(screen.queryByRole("button", { name: "Earlier tabs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More tabs" }));
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(cut()).toContain("Browse");
    // At 54 Browse is off (-54..-4), so it's the one brought back: the selected tab is one tap away.
    fireEvent.click(screen.getByRole("button", { name: "Earlier tabs" }));
    expect(list.scrollLeft).toBe(0);
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(cut()).not.toContain("Browse");
    expect(screen.queryByRole("button", { name: "Earlier tabs" })).toBeNull();
  });

  it("with search open only the selected tab stays, whole, and no chevron", () => {
    layOut();
    row("browse", true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Browse"]);
    expect(screen.queryByRole("button", { name: "More tabs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Earlier tabs" })).toBeNull();
  });

  it("a row that fits has no chevron and hides nothing", () => {
    render(<MemoryRouter><SectionTabs label="Jobs" tabs={TABS.slice(0, 2)} value="buying" onChange={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "More tabs" })).toBeNull();
    expect(cut()).toEqual([]);
  });
});

describe("Declutter Browse follows Jobs' row", () => {
  const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

  it("reuses the same search and has no search row of its own", () => {
    const browse = code("src/components/declutter/DeclutterBrowseView.tsx");
    expect(code("src/pages/home/Dashboard.tsx")).toMatch(/data-browse-phone-controls[\s\S]{0,200}<InlineListSearch/);
    expect(browse).toMatch(/data-browse-phone-controls[\s\S]{0,200}<InlineListSearch/);
    expect(browse).not.toContain("SectionSearchRow");
    expect(code("src/components/declutter/DeclutterBrowseBar.tsx")).not.toContain("SectionSearchRow");
    expect(TABS.length).toBeGreaterThan(4);
  });

  it("Jobs and Declutter both give the row to an open search, with the slot held and the field filling it", () => {
    for (const f of ["src/pages/home/Dashboard.tsx", "src/components/declutter/DeclutterBrowseView.tsx"]) {
      expect(code(f), f).toMatch(/<InlineListSearch[^>]*onOpenChange=\{[^}]+\} fill \/>\s*\{\w+ && <SearchTriggerSlot width="40px" \/>\}/);
    }
    expect(code("src/pages/home/Dashboard.tsx")).toContain("onlySelected: phoneSearchOpen");
    expect(code("src/pages/jobs/JobsSection.tsx")).toContain("onlySelected={browse?.onlySelected}");
    // The row's gap-1 is cancelled by -ml-1 when closed; open, the field keeps 8px from the tab.
    expect(code("src/pages/home/Dashboard.tsx")).toContain('phoneSearchOpen ? "ml-2 min-w-0 flex-1"');
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).toContain('searchOpen ? "ml-2 min-w-0 flex-1"');
  });
});
