import {
  useRef,
  useEffect,
  useState,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * VirtualizedJobList — element-scroll virtualizer for the Dashboard's
 * unbounded "Everything else" job feed.
 *
 * Unlike the window-scroll `VirtualList`, this app scrolls *inside* an
 * element (the `PullToRefreshWrapper`'s `overflow-auto` div, locked
 * under `PageScaffold`'s `100dvh` shell). A window virtualizer never
 * fires here because the document itself does not scroll — so this
 * component drives `useVirtualizer` off the real scroll element.
 *
 * The virtualized list is nested several layers below the scroll
 * container (recommended section + section headers render above it as
 * normal DOM). `useVirtualizer` accounts for that gap with `scrollMargin`
 * — the spacer's offset relative to the scroll element. Because the
 * content above is variable height (the recommended section is optional),
 * the margin is measured after layout and re-measured on resize.
 *
 * Rows are dynamically measured (`measureElement`) so `SwipeableJobCard`
 * expand/collapse re-flows the list without leaving gaps. The card's
 * own horizontal swipe gesture is unaffected: drag is x-axis only, the
 * virtualizer only owns vertical layout, and each card keeps its own
 * `overflow-hidden` wrapper inside the absolutely-positioned row.
 */
export interface VirtualizedJobListProps<T> {
  items: T[];
  /** The actual scroll element — the PullToRefreshWrapper's container. */
  scrollElementRef: RefObject<HTMLDivElement>;
  /** Stable unique key per row. */
  getKey: (item: T, index: number) => string;
  /** Renders a single row. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated row height in px before measurement. */
  estimateSize?: number;
  /** Rows rendered outside the visible window. */
  overscan?: number;
  /** Optional className for the outer (sizing) container. */
  className?: string;
}

export function VirtualizedJobList<T>({
  items,
  scrollElementRef,
  getKey,
  renderItem,
  estimateSize = 132,
  overscan = 6,
  className,
}: VirtualizedJobListProps<T>) {
  // The sizing container. Its top edge — measured relative to the scroll
  // element's content origin — is the `scrollMargin` the virtualizer
  // needs so absolute row offsets line up with the headers above it.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Measure the list's offset from the top of the scroll container's
  // scrollable content. `offsetTop` walks the offsetParent chain, so we
  // sum offsets until we reach (or pass) the scroll element. Re-run on
  // layout changes that move the list (recommended section appearing,
  // viewport resize, filter changes shrinking the header block).
  useLayoutEffect(() => {
    const measure = () => {
      const listEl = listRef.current;
      const scrollEl = scrollElementRef.current;
      if (!listEl || !scrollEl) return;
      // Distance from the scroll element's content top to the list top.
      // getBoundingClientRect deltas + current scrollTop give the offset
      // within the scrollable content, independent of how far we've
      // scrolled when the measurement runs.
      const listTop = listEl.getBoundingClientRect().top;
      const scrollTop = scrollEl.getBoundingClientRect().top;
      const next = listTop - scrollTop + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };

    measure();

    const scrollEl = scrollElementRef.current;
    const listEl = listRef.current;
    if (!scrollEl || !listEl || typeof ResizeObserver === "undefined") {
      return;
    }
    // Watch the scroll container (its content above the list can grow /
    // shrink) so the margin stays correct without a scroll event.
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    // Observe the list's previous sibling region by watching the scroll
    // element's first child — header height changes reflow into it.
    const inner = scrollEl.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [scrollElementRef, items.length]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    // A stable key keeps measurement cache aligned to a job across
    // filter / refresh churn, so expanded heights are not lost.
    getItemKey: (index) => getKey(items[index], index),
  });

  // Re-measure when the list length changes (filter, infinite-scroll
  // append, dismiss) so row positions stay accurate.
  useEffect(() => {
    virtualizer.measure();
  }, [items.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className={className}
      style={{
        position: "relative",
        height: virtualizer.getTotalSize(),
        width: "100%",
      }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              // Subtract scrollMargin: virtualRow.start is measured from
              // the scroll element's content origin, but this row is
              // positioned relative to the list container which already
              // sits `scrollMargin` px down.
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              // Ease the position shift so rows below an expand/collapse
              // glide rather than snapping when measureElement re-reports a
              // card's height — softens the remeasure flicker. Transform
              // only (no layout cost), short enough to feel instant.
              transition: "transform 150ms ease-out",
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
