// The pin-anchored preview popover on the Browse map (BrowseMap.tsx): its placement and geometry.

/** Placement of the pin-anchored preview popover, in `mapBoxRef` pixels.
 *  `caretDir` "down": card sits above the pin, caret on its bottom edge points
 *  down at the pin. "up": card flipped below the pin, caret on its top edge. */
export type PreviewPlacement = {
  left: number;
  top: number;
  caretLeft: number;
  caretDir: "up" | "down";
};

/** Popover geometry constants (px). */
export const PREVIEW_CARD_MAX_W = 416; // 26rem — matches the old sheet's max width.
export const PREVIEW_EDGE = 8; // keep the card this far from every map edge.
export const PREVIEW_CARET = 9; // caret height / gap between card and pin.
