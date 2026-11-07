/**
 * Senior mode at 320 (prod-audit 11-05, re-measured 11-07 on a local dev server against prod reads,
 * ~/.lh-shots/b5-senior): Jobs' Browse Posted Working at 16px were 206px in a 192px track, so the "less" chevron (44px)
 * and the worded "1 more" pill (90px) both came in and left a 46px track for the 57px selected tab, which read "osted".
 * When the selected tab cannot be whole beside the worded pill, the pill drops its words (index.css hides the label
 * under [data-tabs-more-compact]); its spoken name still says how many tabs it hides. Measured after: track 92px,
 * "Posted" 57px whole. Layout is stubbed (jsdom has none), as in tabChevronCarriesHiddenCounts.
 *
 * @mutate src/components/sections/SectionTabs.tsx | compact = list.clientWidth + 1 < selW; | compact = false;
 * @mutate src/components/sections/SectionTabs.tsx | data-tabs-more-compact={compactMore ? "" : undefined} | data-tabs-more-compact={undefined}
 * @mutate src/index.css | [data-tabs-more-compact] [data-testid="tabs-more-label"] {\n  display: none; | [data-tabs-more-compact] [data-testid="tabs-more-label"] {\n  display: inline;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SectionTabs } from "@/components/sections/SectionTabs";

const TAB_W = 57;
let track = 46;
const TABS = [{ value: "posted", label: "Posted" }, { value: "working", label: "Working" }] as const;

/** Fixed-width tabs, 8px apart, in a `track`-wide row, following scrollLeft. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="tablist"]') as HTMLElement | null;
    if (this.getAttribute("role") === "tablist") return { left: 0, right: track, width: track } as DOMRect;
    if (this.getAttribute("role") === "tab" && list) {
      const i = Array.from(list.children).indexOf(this);
      const left = i * (TAB_W + 8) - list.scrollLeft;
      return { left, right: left + TAB_W, width: TAB_W } as DOMRect;
    }
    if (this.hasAttribute("data-tabs-more-button")) return { left: 0, right: 90, width: 90 } as DOMRect;
    return { left: 0, right: 0, width: 0 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(3 * (TAB_W + 8));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => track);
}
/** Renders, then re-measures once the pill has mounted (a browser's ResizeObserver does it; jsdom has none). */
function row(value: string) {
  render(<MemoryRouter><SectionTabs label="Jobs view" tabs={TABS} value={value as "posted"} onChange={() => undefined} /></MemoryRouter>);
  act(() => { screen.getByRole("tablist").dispatchEvent(new Event("scroll")); });
}

afterEach(() => { vi.restoreAllMocks(); track = 46; });

describe("the selected tab stays whole beside the More pill (senior mode at 320)", () => {
  it("a track narrower than the selected tab puts the pill in its chevron-only form", () => {
    track = 46;
    layOut();
    row("posted");
    const more = screen.getByRole("button", { name: /more tab/ });
    expect(more.hasAttribute("data-tabs-more-compact")).toBe(true);
    // The pill's spoken name still counts the hidden tabs.
    expect(more.getAttribute("aria-label")).toMatch(/^\d+ more tab/);
  });

  it("a track that holds the selected tab keeps the worded pill (Q2563)", () => {
    track = 120;
    layOut();
    row("browse");
    const more = screen.getByRole("button", { name: /more tab/ });
    expect(more.hasAttribute("data-tabs-more-compact")).toBe(false);
    expect(screen.getByTestId("tabs-more-label").textContent).toMatch(/more/);
  });

  it("index.css hides the words and keeps the chevron in the compact form", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/\[data-tabs-more-compact\] \[data-testid="tabs-more-label"\] \{\s*display: none;/);
    expect(css).not.toMatch(/\[data-tabs-more-compact\][^{]*\[data-tabs-more-pill\] \{\s*display: none/);
  });
});
