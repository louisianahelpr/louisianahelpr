/**
 * Shipping (Q2259, docs/specs/shipping-draft.md section 6): the boxes a small listing can ship in. They match
 * ship-rates' PARCEL_PRESETS (supabase/functions/_shared/easypostRates.ts) and the declutter_items CHECK.
 */
export type ShipPreset = "envelope" | "small_box" | "medium_box" | "large_box";
export interface ShipOptions { preset: ShipPreset | null }
/** The box words are in the member's language by key (lp.sh.p.<key> in enListingParts / esListingParts, F260q). */
export const SHIP_PRESETS: ReadonlyArray<{ key: ShipPreset }> = [
  { key: "envelope" },
  { key: "small_box" },
  { key: "medium_box" },
  { key: "large_box" },
];
/** Section 8: listings in these categories are pickup only (v1 ships nothing with a lithium battery). */
export const SHIP_PICKUP_ONLY_CATEGORIES: ReadonlySet<string> = new Set(["electronics", "appliances"]);
