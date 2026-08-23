import { useRef, useEffect, type ReactNode, type CSSProperties } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

/**
 * Lightweight wrapper around @tanstack/react-virtual using the WINDOW as
 * the scroll source. This keeps existing page layouts (sticky headers,
 * pull-to-refresh) intact while still rendering only visible rows + overscan.
 *
 * Use it for very long lists (dashboard job feed, activity tabs, message
 * threads) so the DOM stays small on older devices.
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

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan,
    // Account for the container's offset from the top of the document so
    // virtualization aligns with content above (headers, banners, etc.).
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });

  // Re-measure when the list LENGTH changes (filter / refresh) so positions
  // stay accurate.
  //
  // `virtualizer` must NOT be in the dep array. It is a fresh object on every
  // render, so including it ran this effect on every render — and
  // `measure()` RESETS every recorded item size back to `estimateSize`. The
  // `ref={virtualizer.measureElement}` below would measure a row at its real
  // height, the next render would throw that away, and the list kept laying
  // itself out on the estimate forever. With estimateSize=250 against 101px
  // rows, the browse feed rendered a 149px dead gap under every row.
  //
   
  useEffect(() => {
    virtualizer.measure();
  }, [items.length]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const offset = parentRef.current?.offsetTop ?? 0;

  return (
    <div
      ref={parentRef}
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
              transform: `translateY(${virtualRow.start - offset}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
