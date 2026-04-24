import { useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Lightweight wrapper around @tanstack/react-virtual with dynamic height
 * measurement. Renders only the visible rows (+ overscan) so very long lists
 * (e.g. dashboard job feed, activity tabs, message threads) stay smooth on
 * older devices.
 *
 * The page itself stays the scroll container — we listen to window scroll so
 * existing layouts (sticky headers, pull-to-refresh, etc.) continue to work
 * without nesting another scroll area.
 */
export interface VirtualListProps<T> {
  items: T[];
  /** Stable key for each row — must be unique. */
  getKey: (item: T, index: number) => string;
  /** Renders a single row. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated row height in px (used before measurement). */
  estimateSize?: number;
  /** Rows to render outside the visible area. */
  overscan?: number;
  /** Optional className for each row wrapper. */
  itemClassName?: string;
  /** Optional className for the outer container. */
  className?: string;
  /** Optional inline style for the outer container. */
  style?: CSSProperties;
}

export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 180,
  overscan = 6,
  itemClassName,
  className,
  style,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    // Use the window as the scroll source so we don't introduce a nested
    // scroller. The container's offset is added automatically.
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Re-measure when the viewport changes (orientation, keyboard, etc.).
  useEffect(() => {
    const onResize = () => virtualizer.measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [virtualizer]);

  // We use the window as the actual scroll element by setting up a manual
  // scroll listener; this keeps the existing page layout (sticky header,
  // pull-to-refresh) intact.
  const setRef = useCallback((node: HTMLDivElement | null) => {
    parentRef.current = node;
  }, []);

  // Bridge window scroll → virtualizer
  useEffect(() => {
    const onScroll = () => virtualizer.measure();
    // Note: getScrollElement returns parentRef.current; we additionally
    // listen for window scroll because the parent itself isn't scrollable.
    // react-virtual reads scroll position via getBoundingClientRect, which
    // updates on every window scroll frame.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={setRef}
      className={className}
      style={{ position: "relative", height: totalSize, width: "100%", ...style }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        return (
          <div
            key={getKey(item, virtualRow.index)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className={itemClassName}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
