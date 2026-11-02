/**
 * A3-97 (audit 7, 11-01): on a 375 phone Declutter showed "Browse · Buying 2 ›". Selling, Deliver, Wanted and Free were
 * scrolled out of view behind a 28 px chevron, so a seller's to-do count (an offer to answer, a sale to set out) was off
 * screen. The chevrons now carry the to-do counts of the tabs they hide ("3 ›", read as "More tabs, 3 to do") and are a
 * 44 px target like every other control. Layout is stubbed (jsdom has none), as in sectionTabsNeverCutAWord.
 *
 * @mutate src/components/sections/SectionTabs.tsx |         if (n > 0 && t.right > box.right + 1) ahead += n; |         if (false) ahead += n;
 * @mutate src/components/sections/SectionTabs.tsx |         else if (n > 0 && t.left < box.left - 1) behind += n; |         else if (false) behind += n;
 * @mutate src/components/sections/SectionTabs.tsx |               data-tab-count={o.count && o.count > 0 ? o.count : undefined}\n |
 * @mutate src/components/sections/SectionTabs.tsx | aria-label={aheadCount > 0 ? tr("tabs.moreToDo", { n: aheadCount }) : tr("tabs.more")} | aria-label={tr("tabs.more")}
 * @mutate src/components/sections/SectionTabs.tsx | {aheadCount > 0 && <span data-testid="tabs-more-count" | {false && <span data-testid="tabs-more-count"
 * @mutate src/components/sections/SectionTabs.tsx | data-tabs-more-button="" onClick={showNext}\n          className="inline-flex h-11 min-w-11 | data-tabs-more-button="" onClick={showNext}\n          className="inline-flex h-11 w-7 !min-w-0
 * @mutate src/components/sections/SectionTabs.tsx | data-tabs-less-button="" onClick={showPrevious}\n          className="inline-flex h-11 min-w-11 | data-tabs-less-button="" onClick={showPrevious}\n          className="inline-flex h-11 w-7 !min-w-0
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SectionTabs } from "@/components/sections/SectionTabs";

const TAB_W = 50;
let track = 170;
function tabs(counts: Record<string, number>) {
  return ["buying", "selling", "deliver", "wanted", "free"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), count: counts[v] }));
}
/** Stub layout (2026-11-01): fixed-width tabs, evenly spaced, in a `track`-wide row, following scrollLeft. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="tablist"]') as HTMLElement | null;
    if (this.getAttribute("role") === "tablist") return { left: 0, right: track, width: track } as DOMRect;
    if (this.getAttribute("role") === "tab" && list) {
      const i = Array.from(list.children).indexOf(this);
      const left = i * (TAB_W + 8) - list.scrollLeft;
      return { left, right: left + TAB_W, width: TAB_W } as DOMRect;
    }
    return { left: 0, right: 0, width: 0 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(6 * 58);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => track);
}
function row(counts: Record<string, number>, value = "browse") {
  return render(<MemoryRouter><SectionTabs label="Declutter view" tabs={tabs(counts)} value={value as "buying"} onChange={() => undefined} /></MemoryRouter>);
}

afterEach(() => { vi.restoreAllMocks(); track = 170; });

describe("A3-97: a hidden tab's to-do count shows on the chevron", () => {
  it("a phone row showing only Browse and Buying puts Selling's count on the More chevron", () => {
    track = 110; // Browse 0-50 and Buying 58-108 fit; Selling (116-166) is off the edge.
    layOut();
    row({ buying: 2, selling: 3 });
    const more = screen.getByRole("button", { name: "More tabs, 3 to do" });
    expect(screen.getByTestId("tabs-more-count").textContent).toBe("3");
    expect(more.contains(screen.getByTestId("tabs-more-count"))).toBe(true);
  });

  it("adds up every hidden count, and leaves out the counts already on screen", () => {
    layOut();
    row({ selling: 2, wanted: 1, free: 4 }); // Selling shows; Wanted and Free are hidden.
    expect(screen.getByTestId("tabs-more-count").textContent).toBe("5");
    expect(screen.getByRole("button", { name: "More tabs, 5 to do" })).toBeInTheDocument();
  });

  it("no hidden count: a plain chevron with no badge", () => {
    layOut();
    row({ buying: 2 });
    expect(screen.queryByTestId("tabs-more-count")).toBeNull();
    expect(screen.getByRole("button", { name: "More tabs" })).toBeInTheDocument();
  });

  it("moved along, the way back carries the counts of the tabs off the start", () => {
    layOut();
    row({ buying: 2, free: 1 });
    const list = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "More tabs, 1 to do" }));
    fireEvent.click(screen.getByRole("button", { name: /More tabs/ }));
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(list.scrollLeft).toBeGreaterThan(58);
    expect(screen.getByRole("button", { name: "Earlier tabs, 2 to do" })).toBeInTheDocument();
    expect(screen.getByTestId("tabs-less-count").textContent).toBe("2");
  });

  it("both chevrons are 44 px targets, not the old 28 px (w-7) strip", () => {
    layOut();
    row({ free: 1 });
    const list = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: /More tabs/ }));
    act(() => { list.dispatchEvent(new Event("scroll")); });
    const buttons = [screen.getByRole("button", { name: /More tabs/ }), screen.getByRole("button", { name: /Earlier tabs/ })];
    expect(buttons.length).toBeGreaterThan(1);
    for (const b of buttons) {
      expect(b.className).toMatch(/\bh-11\b/);
      expect(b.className).toMatch(/\bmin-w-11\b/);
      expect(b.className).not.toMatch(/\bw-7\b|!min-w-0/);
    }
  });
});
