import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/**
 * The light half of ScrollAway.tsx (owner 11-14, Depop/Vinted audit item 5): the scope and the spacer that every
 * SectionScreen draws, so Home, Shops and Homes (and the Declutter item page) carry only this on their critical path.
 * The rows themselves, with the scroll listener, live in ScrollAway.tsx and load with Jobs and Declutter Browse only
 * (Q178 critical-path budget: /home and /declutter/item/:id were over their bands with the whole module on the path).
 * The full description is in ScrollAway.tsx. Guard: src/test/scrollAwayRows.test.tsx.
 */

export type Scope = {
  rows: boolean;
  setRows: (on: boolean) => void;
  spacer: HTMLElement | null;
  setSpacer: (el: HTMLElement | null) => void;
  height: number;
  setHeight: (h: number) => void;
};

export const ScrollAwayContext = createContext<Scope | null>(null);

/** Holds the rows and the spacer of one screen (SectionScreen; JobsSection around its Browse page). */
export function ScrollAwayScope({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState(false);
  const [spacer, setSpacer] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  const value = useMemo(() => ({ rows, setRows, spacer, setSpacer, height, setHeight }), [rows, spacer, height]);
  return <ScrollAwayContext.Provider value={value}>{children}</ScrollAwayContext.Provider>;
}

/** Overlay mode: a phone, rows and spacer both drawn, the rows measured. */
export function useOverlay(scope: Scope | null) {
  const desktop = useIsWebDesktop();
  return !desktop && !!scope && scope.rows && !!scope.spacer && scope.height > 0;
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
