import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/**
 * TABS AND CHIPS SLIDE AWAY ON A PHONE (owner 11-14, Depop/Vinted audit item 5: "search sticky; chips hide on scroll
 * down, return on scroll up"). On Jobs Browse and Declutter Browse the one-row top bar (search, Messages, bell, photo)
 * stays put; the rows under it (the Browse | Posted | Working tabs and the category chips) slide up behind it once the
 * list has moved 8px down, and slide back once it has moved 8px up. Always shown at the top of the list, never hidden
 * under prefers-reduced-motion, never on the desktop website.
 *
 * NOTHING MOVES BUT THE ROWS (a transform, no layout shift): the rows wrapper takes its own height back with a negative
 * bottom margin, so the list starts under it, and ScrollAwaySpacer, the first thing inside the list's scroll element,
 * holds exactly that height. At rest the list sits where it always did; hiding only translates the rows. Both switch on
 * together, and only while the page has drawn a spacer (Jobs Posted/Working, a loading frame or any other tab keep the
 * steady header).
 *
 * WHICH ELEMENT SCROLLS: whichever contains the spacer (Jobs: the feed's pull-to-refresh box; Declutter: SectionScreen's
 * scroll column; the window if a page ever scrolls the document). Scroll events do not bubble, so one capture-phase
 * listener on the document hears every scroller and keeps only that one. iOS (the Capacitor WKWebView) fires scroll
 * events through momentum; its rubber band reads as scrollTop < 0 (shown) at the top and past the end (ignored).
 *
 * Guard: src/test/scrollAwayRows.test.tsx.
 */

/** How far the list moves (px) in one direction before the rows hide or come back. */
export const SCROLL_AWAY_THRESHOLD = 8;

type Scope = {
  rows: boolean;
  setRows: (on: boolean) => void;
  spacer: HTMLElement | null;
  setSpacer: (el: HTMLElement | null) => void;
  height: number;
  setHeight: (h: number) => void;
};

const ScrollAwayContext = createContext<Scope | null>(null);

/** Holds the rows and the spacer of one screen (SectionScreen; JobsSection around its Browse page). */
export function ScrollAwayScope({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState(false);
  const [spacer, setSpacer] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  const value = useMemo(() => ({ rows, setRows, spacer, setSpacer, height, setHeight }), [rows, spacer, height]);
  return <ScrollAwayContext.Provider value={value}>{children}</ScrollAwayContext.Provider>;
}

/** Overlay mode: a phone, rows and spacer both drawn, the rows measured. */
function useOverlay(scope: Scope | null) {
  const desktop = useIsWebDesktop();
  return !desktop && !!scope && scope.rows && !!scope.spacer && scope.height > 0;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The scroll direction rule, kept pure for the guard: given the scroller's position, the last turning point and
 * whether the rows are hidden, the new state. Top (<= 0) always shows; past the end (iOS bounce) changes nothing.
 */
export function nextScrollAway(top: number, max: number, anchor: number, hidden: boolean): { hidden: boolean; anchor: number } {
  if (top <= 0) return { hidden: false, anchor: 0 };
  if (top > max) return { hidden, anchor };
  if (!hidden && top - anchor >= SCROLL_AWAY_THRESHOLD) return { hidden: true, anchor: top };
  if (hidden && anchor - top >= SCROLL_AWAY_THRESHOLD) return { hidden: false, anchor: top };
  // Still moving the same way: the turning point follows, so the way back is measured from the furthest point.
  if (hidden ? top > anchor : top < anchor) return { hidden, anchor: top };
  return { hidden, anchor };
}

/** The tabs and chips rows under the top bar. Desktop, or `off` (a tab other than Browse): drawn as they are. */
export function ScrollAwayRows({ off = false, children }: { off?: boolean; children: ReactNode }) {
  const scope = useContext(ScrollAwayContext);
  const desktop = useIsWebDesktop() || off;
  const overlay = useOverlay(scope);
  const outer = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const setRows = scope?.setRows;
  const setHeight = scope?.setHeight;

  useLayoutEffect(() => {
    if (desktop || !setRows) return;
    setRows(true);
    return () => setRows(false);
  }, [desktop, setRows]);

  // The rows' own height (transforms do not change it), measured before paint and again whenever it changes.
  useLayoutEffect(() => {
    const el = outer.current;
    if (desktop || !el || !setHeight) return;
    const read = () => setHeight(el.offsetHeight);
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { ro.disconnect(); setHeight(0); };
  }, [desktop, setHeight]);

  const spacer = scope?.spacer ?? null;
  useEffect(() => {
    if (!overlay || !spacer || prefersReducedMotion()) {
      setHidden(false);
      return;
    }
    let anchor = 0;
    let isHidden = false;
    const onScroll = (e: Event) => {
      const t = e.target;
      const el = t === document || t === window ? document.scrollingElement : t instanceof Element ? t : null;
      if (!el || !el.contains(spacer)) return;
      const next = nextScrollAway(el.scrollTop, el.scrollHeight - el.clientHeight, anchor, isHidden);
      anchor = next.anchor;
      if (next.hidden !== isHidden) {
        isHidden = next.hidden;
        setHidden(isHidden);
      }
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      setHidden(false);
    };
  }, [overlay, spacer]);

  if (desktop) return <>{children}</>;
  return (
    // The outer box clips the rows as they slide up into it and lets taps through where they have gone; the inner one
    // carries the page's own canvas so the list passes under it unseen. Keyboard focus inside brings them back.
    <div
      ref={outer}
      data-scroll-away=""
      data-hidden={hidden ? "" : undefined}
      className="relative z-10 overflow-hidden pointer-events-none"
      style={overlay ? { marginBottom: -scope!.height } : undefined}
      onFocusCapture={() => setHidden(false)}
    >
      <div
        className="bg-premium-page pointer-events-auto flex flex-col gap-1 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
        // No transform at rest: a transformed box paints a fixed-attachment background (the page's gradient) as its own.
        style={hidden ? { transform: "translateY(-100%)" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The first thing inside the list's scroll element: as tall as the rows while they overlay the list. Drawn only once a
 * page's ScrollAwayRows is on screen (a phone), so every other screen's markup (Shops, Homes, Home, the route skeletons
 * and index.html's copies of them) is unchanged.
 */
export function ScrollAwaySpacer() {
  const scope = useContext(ScrollAwayContext);
  const overlay = useOverlay(scope);
  const setSpacer = scope?.setSpacer;
  const ref = useCallback((el: HTMLDivElement | null) => setSpacer?.(el), [setSpacer]);
  if (!scope?.rows) return null;
  return <div ref={ref} aria-hidden data-scroll-away-spacer="" className="shrink-0" style={{ height: overlay ? scope.height : 0 }} />;
}
