/* Moved verbatim from JobDetailDialog.tsx (Q806 god-component ratchet); JobDetailDialog re-exports both. */

/* ── THE SHEET'S TOP-RIGHT LANE, IN PIXELS ─────────────────────────────────
   Exported so a guard can diff it against the geometry dialog.tsx actually
   declares, instead of against a copy of these numbers. See
   src/test/dialogCornerLaneIsReserved.test.ts — it re-derives every input
   below by reading dialog.tsx and the icon button, and fails when this falls
   short, which is how the 2026-09-19 overlap was caught. */
const DIALOG_CLOSE_X_RIGHT = 4;   // dialog.tsx: the X's `right-1`
const DIALOG_CLOSE_X_BOX = 44;    // dialog.tsx: its stated 44x44 box
const DIALOG_SLOT_ROW_RIGHT = 56; // dialog.tsx: `right-[56px]`
const DIALOG_SLOT_ICON = 44;      // IconActionButton/ShareJobButton `bare`
const DIALOG_SLOT_GAP = 8;        // dialog.tsx: `gap-2`

/**
 * How much of the sheet's right edge the close X — plus `iconCount` chrome
 * icons to its left — occupies. Anything drawn in that top band must reserve
 * it or it paints over the buttons.
 */
export function cornerIconLaneReservePx(iconCount: number): number {
  if (iconCount <= 0) return DIALOG_CLOSE_X_RIGHT + DIALOG_CLOSE_X_BOX;
  return (
    DIALOG_SLOT_ROW_RIGHT +
    iconCount * DIALOG_SLOT_ICON +
    (iconCount - 1) * DIALOG_SLOT_GAP
  );
}

/** Below this much reserved lane, the longest category label cannot fit on a
 *  320px sheet and steps aside for its glyph. */
export const CROWDED_RAIL_RESERVE_PX = 200;
