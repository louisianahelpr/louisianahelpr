/**
 * THE ONE LOOK FOR A SHEET'S CORNER ICONS (owner 2026-10-25, Browse -> tap a job: "the 4 icons at top do different
 * stuff on hover"). Share, Save and Report sat beside the sheet's close X with a 6px square, no hover wash, a colour
 * that never changed (an inline colour beat `hover:text-foreground`) and a glyph that hopped or tilted; the X was a
 * disc that tinted and held still. Every corner icon now wears the X's look: the one exit disc (`.ctl-exit`), the
 * neutral hover wash (`.ctl-tint`), muted -> foreground ink, the one press (`.btn-press`), the global focus ring, and
 * a glyph that never moves on hover. Size stays where each caller states it (44px, the HIG floor;
 * src/test/dialogCornerLaneIsReserved.test.ts reads those numbers).
 *
 * Used by IconActionButton and ShareJobButton in their `bare` form. DialogContent's own X (src/components/ui/dialog.tsx)
 * spells the same tokens inline, because scripts/back-control-inventory.mjs reads an exit control's shape from its
 * literal class list; src/test/sheetCornerIconsOneLook.test.ts holds the two spellings equal.
 */
export const CHROME_ICON_LOOK =
  "group p-0 box-border ctl-exit btn-press ctl-tint flex items-center justify-center text-muted-foreground hover:text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none";
