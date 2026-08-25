import type { CSSProperties } from "react";

/**
 * Flattens a shared `EmptyState` / `ErrorState` that is rendered INSIDE an
 * `AdminCard`.
 *
 * Both of those primitives draw their own `liquid-glass` card, which is right
 * when they stand alone on the page (Reports, Support) but wrong once a view
 * adopts `AdminCard` — you get a white tile inside a white tile, which is the
 * exact "double-carded" defect the IDV queue shipped before this pass. The
 * card can't simply be dropped when a list is empty, because it carries the
 * header action that CREATES the missing thing (New Broadcast, Refresh).
 *
 * So the outer AdminCard stays and the inner surface goes flat, via the
 * `surfaceStyle` escape hatch EmptyState documents for exactly this ("only for
 * the handful of pages that deliberately run a different card material").
 * `padding` is trimmed too: the outer card already supplies its own.
 */
export const NESTED_EMPTY_SURFACE: CSSProperties = {
  background: "transparent",
  border: "none",
  boxShadow: "none",
  paddingTop: "2.5rem",
  paddingBottom: "2.5rem",
};
