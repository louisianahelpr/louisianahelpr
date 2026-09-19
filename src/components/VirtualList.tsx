import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type CSSProperties,
  type RefObject,
  type MutableRefObject,
} from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";

/**
 * Lightweight wrapper around @tanstack/react-virtual.
 *
 * TWO scroll sources, and picking the wrong one silently truncates the list:
 *
 *  - WINDOW (the default, `scrollElementRef` omitted). Correct only on a
 *    document-scroll route — one that is listed in `DOCUMENT_SCROLL_ROUTES`
 *    (src/hooks/useAppShellViewport.ts), so `<html>` does NOT carry the
 *    `app-shell` class and the document itself actually scrolls.
 *
 *  - ELEMENT (`scrollElementRef` given). Required on every AppShell /
 *    PageScaffold route: those are deliberately OFF `DOCUMENT_SCROLL_ROUTES`,
 *    and `html.app-shell { overflow: hidden }` (src/index.css) pins
 *    `window.scrollY` at 0 forever. A window virtualizer there mounts exactly
 *    one viewport of rows and never mounts another, because the only signal it
 *    listens to never changes. Measured on /messages 2026-09-19 with 29
 *    threads: 16 rows mounted at 375, still 16 after scrolling the real
 *    container 1758px — 13 threads unreachable behind a blank panel.
 *
 * The class guard is scripts/check-virtual-list-scroll-source.mjs +
 * src/test/virtualListScrollSource.test.ts: any call site on an app-shell
 * route that omits `scrollElementRef` fails CI.
 *
 * Use it for very long lists (dashboard job feed, activity tabs, inbox) so the
 * DOM stays small on older devices.
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
  /**
   * The real scroll element, when this list lives inside one (AppShell /
   * PageScaffold routes, where the document does not scroll). Omit ONLY on a
   * document-scroll route. See the component doc above.
   */
  scrollElementRef?: RefObject<HTMLElement | null>;
  /**
   * Optional handle for imperative scrolling (e.g. "open the inbox on the
   * first unread thread"). Assigned after mount, nulled on unmount.
   */
  virtualizerRef?: MutableRefObject<VirtualListHandle | null>;
}

/** What callers may do imperatively to a mounted VirtualList. */
export interface VirtualListHandle {
  scrollToIndex: (index: number, opts?: { align?: "start" | "center" | "end" | "auto" }) => void;
  /** How many rows the list currently holds — lets a caller bounds-check. */
  count: number;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  // Whether a call site scrolls the window or an element is a property of the
  // ROUTE, so it never changes across a given list's life. Branching on it at
  // the top level keeps each implementation's hooks unconditional.
  return props.scrollElementRef
    ? <ElementVirtualList {...props} scrollElementRef={props.scrollElementRef} />
    : <WindowVirtualList {...props} />;
}

// ---------------------------------------------------------------------------
// Window scroll source — document-scroll routes only.
// ---------------------------------------------------------------------------

function WindowVirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 180,
  overscan = 6,
  itemClassName,
  className,
  style,
  virtualizerRef,
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

  useVirtualizerHandle(virtualizerRef, virtualizer.scrollToIndex, items.length);

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

// ---------------------------------------------------------------------------
// Element scroll source — AppShell / PageScaffold routes.
// ---------------------------------------------------------------------------

function ElementVirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 180,
  overscan = 6,
  itemClassName,
  className,
  style,
  scrollElementRef,
  virtualizerRef,
}: VirtualListProps<T> & { scrollElementRef: RefObject<HTMLElement | null> }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Distance from the scroll element's CONTENT origin to this list's top —
  // the rows above it (tabs, banners, pinned sections) are normal DOM, and
  // without this the virtualizer's absolute offsets are shifted by their
  // height. Measured after layout because that content is variable.
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const listEl = parentRef.current;
      const scrollEl = scrollElementRef.current;
      if (!listEl || !scrollEl) return;
      // getBoundingClientRect deltas + the current scrollTop give the offset
      // within the scrollable content, independent of how far we have
      // scrolled when the measurement happens to run.
      const next =
        listEl.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };

    measure();

    const scrollEl = scrollElementRef.current;
    if (!scrollEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
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
    // A stable key keeps the measurement cache aligned to a row across
    // filter / refresh churn, so measured heights are not lost.
    getItemKey: (index) => getKey(items[index], index),
  });

  // Same reasoning as the window path: length only, never `virtualizer`.
  //

  useEffect(() => {
    virtualizer.measure();
  }, [items.length]);

  useVirtualizerHandle(virtualizerRef, virtualizer.scrollToIndex, items.length);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        position: "relative",
        height: virtualizer.getTotalSize(),
        width: "100%",
        ...style,
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
            className={itemClassName}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              // `virtualRow.start` is measured from the scroll element's
              // content origin; this container already sits `scrollMargin`
              // px down inside it.
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}

/** Publishes the imperative handle, keeping `count` fresh for bounds checks. */
function useVirtualizerHandle(
  ref: MutableRefObject<VirtualListHandle | null> | undefined,
  scrollToIndex: VirtualListHandle["scrollToIndex"],
  count: number,
) {
  // A ref so the effect below never has to re-run on a new function identity
  // (the virtualizer is a fresh object every render).
  const scrollRef = useRef(scrollToIndex);
  scrollRef.current = scrollToIndex;
  useEffect(() => {
    if (!ref) return;
    ref.current = {
      scrollToIndex: (index, opts) => scrollRef.current(index, opts),
      count,
    };
    return () => { ref.current = null; };
  }, [ref, count]);
}
