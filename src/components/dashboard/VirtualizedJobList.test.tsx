/**
 * Q154 — the dashboard feed's cards overlapped after a job was optimistically
 * removed (useApplyFlow's onMutate drops the applied job from the feed).
 *
 * Measured cause: VirtualizedJobList called `virtualizer.measure()` on every
 * `items.length` change. In @tanstack/virtual-core `measure()` CLEARS the
 * per-key size cache, and rows that stay mounted are never re-measured: their
 * ref callback is not re-invoked and their ResizeObserver does not fire
 * because their size did not change. Every surviving row fell back to
 * `estimateSize` (92px) while really being ~110px tall, so each card slid up
 * under the one above it — on prod the pitch went from 110px to 92px (18px
 * overlap per row). Row sizes are cached by stable job id, so a count change
 * already re-lays the list out correctly without that call.
 *
 * This renders the real component with a real virtualizer; jsdom has no
 * layout, so row heights are stubbed via `offsetHeight` (what the virtualizer's
 * default `measureElement` reads when no ResizeObserver entry is given).
 */
import { useEffect, useRef, useState } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VirtualizedJobList } from "./VirtualizedJobList";

const ROW_HEIGHT = 110; // real measured card pitch at 375 (card + pb-2 gap)
const ESTIMATE = 92; // BrowseTasksFeed's estimateSize

type Job = { id: string };

let removeFirst: () => void = () => {};

function Harness({ initial }: { initial: Job[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(initial);
  // As on the Dashboard, the scroll container is already mounted when the
  // feed's rows arrive: a child's layout effect runs before its parent's ref
  // is attached, so mounting both in one commit would hide the scroll element
  // from the virtualizer until an unrelated re-render.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(true), []);
  removeFirst = () => setItems((prev) => prev.slice(1));
  return (
    <div ref={scrollRef} data-testid="scroller">
      {loaded && <VirtualizedJobList
        items={items}
        scrollElementRef={scrollRef}
        getKey={(j) => j.id}
        estimateSize={ESTIMATE}
        renderItem={(j) => <div data-job={j.id}>{j.id}</div>}
      />}
    </div>
  );
}

/** translateY offsets of the rendered rows, in index order. */
function rowOffsets(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-index]"))
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    .map((el) => {
      const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
      return m ? Number(m[1]) : NaN;
    });
}

describe("VirtualizedJobList — rows never overlap after an item is removed (Q154)", () => {
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.index !== undefined) return ROW_HEIGHT;
        if (this.dataset.testid === "scroller") return 2000;
        return 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 375;
      },
    });
  });

  afterEach(() => {
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  });

  it("keeps each surviving row a full measured row-height below the previous one", async () => {
    // @mutate src/components/dashboard/VirtualizedJobList.tsx | const virtualItems = virtualizer.getVirtualItems(); | useLayoutEffect(() => { virtualizer.measure(); }, [items.length, virtualizer]); const virtualItems = virtualizer.getVirtualItems();
    const jobs = Array.from({ length: 6 }, (_, i) => ({ id: `job-${i}` }));
    const { container } = render(<Harness initial={jobs} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const before = rowOffsets(container);
    // Inventory floor: the list really rendered rows to compare.
    expect(before.length).toBeGreaterThan(3);
    for (let i = 1; i < before.length; i++) {
      expect(before[i] - before[i - 1]).toBe(ROW_HEIGHT);
    }

    // The optimistic removal (useApplyFlow onMutate drops the applied job).
    await act(async () => {
      removeFirst();
      await new Promise((r) => setTimeout(r, 0));
    });

    const after = rowOffsets(container);
    expect(after.length).toBe(before.length - 1);
    expect(after[0]).toBe(0);
    for (let i = 1; i < after.length; i++) {
      // A stale/cleared size cache puts rows at the 92px estimate: overlap.
      expect(after[i] - after[i - 1]).toBeGreaterThanOrEqual(ROW_HEIGHT);
    }
  });
});
