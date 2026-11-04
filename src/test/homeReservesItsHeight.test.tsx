/**
 * Q2706 (B98, 11-04): Home's Next up card and money strip hold the height they had when they last finished loading on
 * this device, while their reads are out, so nothing below them moves when they land. Lab before (/home, Fast 4G, prod
 * data, local build): two layout shifts, the money strip arriving (0.106) and Next up growing (0.103), CLS 0.209.
 *
 * @mutate src/pages/home/homeDashboard/reservedHeight.ts |     if (!name \|\| loading) return; |     if (!name) return;
 * @mutate src/pages/home/homeDashboard/reservedHeight.ts |     saveReservedHeight(name, el ? el.offsetHeight : 0); |     saveReservedHeight(name, 0);
 * @mutate src/pages/home/HomeDashboard.tsx | style={summary.todosLoading && nextUpReserve ? { minHeight: nextUpReserve } : undefined} | style={undefined}
 * @mutate src/pages/home/HomeDashboard.tsx |             {money.pending && !money.coming && !money.held && moneyReserve > 0 |             {false && moneyReserve > 0
 * @mutate src/pages/home/HomeDashboard.tsx |             {money.pending && !money.coming && !money.held && moneyReserve > 0 |             {money.pending && moneyReserve > 0
 * @mutate src/pages/home/homeDashboard/homeMoney.ts |   return { coming, held, pending }; |   return { coming, held };
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { blankComments } from "./helpers/blankNonCode";
import { readReservedHeight, saveReservedHeight, useReservedHeight } from "@/pages/home/homeDashboard/reservedHeight";

const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

function Block({ loading, h }: { loading: boolean; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reserve = useReservedHeight("t:u1", loading, ref);
  return <div ref={ref} data-reserve={reserve} data-h={h} />;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no layout: offsetHeight reads the data-h the test sets.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return Number(this.dataset.h ?? 0); } });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as { offsetHeight?: number }).offsetHeight;
});

describe("Home's reserved heights", () => {
  it("saves the settled height, never a loading one, and the next mount reserves it", () => {
    const first = render(<Block loading h={40} />);
    expect(readReservedHeight("t:u1")).toBe(0);
    first.rerender(<Block loading={false} h={208} />);
    expect(readReservedHeight("t:u1")).toBe(208);
    first.unmount();
    const again = render(<Block loading h={40} />);
    expect(again.container.querySelector("[data-reserve]")?.getAttribute("data-reserve")).toBe("208");
  });

  it("a block that settles with nothing drawn reserves nothing next time; junk reads as 0", () => {
    saveReservedHeight("t:u1", 150);
    saveReservedHeight("t:u1", 0);
    expect(readReservedHeight("t:u1")).toBe(0);
    localStorage.setItem(`lh:home-reserve:t:u1:${window.innerWidth}`, "NaN");
    expect(readReservedHeight("t:u1")).toBe(0);
  });

  it("Home wires both blocks: Next up's min-height and the money strip's stand-in while pending", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("style={summary.todosLoading && nextUpReserve ? { minHeight: nextUpReserve } : undefined}");
    // A tile whose read answered draws at once; the stand-in only covers the wait while neither tile is known.
    expect(home).toMatch(/\{money\.pending && !money\.coming && !money\.held && moneyReserve > 0\s*\?\s*<div data-home-money-reserve/);
    expect(code("src/pages/home/homeDashboard/homeMoney.ts")).toContain("return { coming, held, pending };");
  });
});
