/**
 * Area 08 H1 (design audit 11-18): the Pinned view's rows overlapped. Switching All -> Pinned changes the list length,
 * VirtualList calls `measure()` (which empties the size cache), and a row that stayed mounted (same key) was never
 * measured again, so it was laid out at `estimateSize` while being taller. Guard: after a length change, the second
 * row starts below the first row's REAL height, not the estimate.
 *
 * @mutate src/components/VirtualList.tsx | v.getVirtualItems(); | void 0;
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, act } from "@testing-library/react";
import { VirtualList } from "@/components/VirtualList";

const ROW = 120;
let restore: PropertyDescriptor | undefined;
beforeAll(() => {
  restore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return ROW; } });
});
afterAll(() => {
  if (restore) Object.defineProperty(HTMLElement.prototype, "offsetHeight", restore);
});

function list(items: string[]) {
  return <VirtualList items={items} getKey={(s) => s} estimateSize={80} renderItem={(s) => <div style={{ height: ROW }}>{s}</div>} />;
}

function offsets(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).map((el) =>
    Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN));
}

describe("VirtualList keeps real row heights across a length change (Pinned view)", () => {
  it("rows that stay mounted are re-measured after the reset", async () => {
    const { container, rerender } = render(list(["a", "b", "c", "d"]));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    rerender(list(["a", "b", "c"]));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const o = offsets(container);
    expect(o.length).toBeGreaterThan(1);
    expect(o[1] - o[0]).toBe(ROW);
    expect(o[2] - o[1]).toBe(ROW);
  });
});
