// @mutate src/components/declutter/DeclutterCategoryChips.tsx |       {more.right && ( |       {more.right && desktop === false && (
// @mutate src/components/declutter/DeclutterCategoryChips.tsx |     if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: "smooth" }); |
/**
 * F053 (UI audit 11-09): Declutter's category chip row ran off the right edge on the desktop website with chips cut in
 * half and no arrow or fade, so a mouse user could not reach the other categories. The row now shows a fade and a round
 * arrow at each edge that has more; the arrow scrolls the row. A phone keeps the swipe (no arrows).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const desktop = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
import { DeclutterCategoryChips } from "@/components/declutter/DeclutterCategoryChips";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";

const items = CATEGORIES.map((c) => ({ category: c.key, current_price_cents: 500 }));

function sized(scrollLeft: number) {
  const row = document.querySelector("[data-chip-row='categories']") as HTMLElement;
  Object.defineProperty(row, "clientWidth", { configurable: true, value: 600 });
  Object.defineProperty(row, "scrollWidth", { configurable: true, value: 2000 });
  row.scrollLeft = scrollLeft;
  return row;
}

afterEach(() => { cleanup(); desktop.on = true; });

describe("F053: the category row has an arrow at each edge with more, on the desktop website", () => {
  it("there are many categories to scroll through (the inventory)", () => {
    expect(items.length).toBeGreaterThan(10);
  });

  it("at the start: a right fade and arrow; the arrow scrolls the row; scrolled: a left arrow too", () => {
    render(<DeclutterCategoryChips items={items} value={null} onChange={() => {}} />);
    const row = sized(0);
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy as never;
    fireEvent.scroll(row);
    const right = screen.getByRole("button", { name: "More categories" });
    expect(screen.queryByRole("button", { name: "Earlier categories" })).toBeNull();
    fireEvent.click(right);
    expect(scrollBy).toHaveBeenCalledWith({ left: 480, behavior: "smooth" });
    row.scrollLeft = 500;
    fireEvent.scroll(row);
    expect(screen.getByRole("button", { name: "Earlier categories" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More categories" })).toBeTruthy();
    row.scrollLeft = 1400;
    fireEvent.scroll(row);
    expect(screen.queryByRole("button", { name: "More categories" })).toBeNull();
  });

  it("the arrows sit over the row, so nothing moves when they appear", () => {
    render(<DeclutterCategoryChips items={items} value={null} onChange={() => {}} />);
    fireEvent.scroll(sized(0));
    const edge = document.querySelector("[data-chip-edge='right']") as HTMLElement;
    expect(edge.className.split(/\s+/)).toContain("absolute");
  });

  it("a phone keeps the swipe: no arrows", () => {
    desktop.on = false;
    render(<DeclutterCategoryChips items={items} value={null} onChange={() => {}} />);
    fireEvent.scroll(sized(0));
    expect(screen.queryByRole("button", { name: "More categories" })).toBeNull();
    expect(document.querySelector("[data-chip-row-wrap]")).toBeNull();
  });
});
