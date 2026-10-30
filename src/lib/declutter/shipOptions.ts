/**
 * Shipping (Q2259, docs/specs/shipping-draft.md section 6): the boxes a small listing can ship in. They match
 * ship-rates' PARCEL_PRESETS (supabase/functions/_shared/easypostRates.ts) and the declutter_items CHECK.
 */
export type ShipPreset = "envelope" | "small_box" | "medium_box" | "large_box";
export interface ShipOptions { preset: ShipPreset | null; seller_pays: boolean }
export const SHIP_PRESETS: ReadonlyArray<{ key: ShipPreset; label: string }> = [
  { key: "envelope", label: "Envelope, up to 8 oz" },
  { key: "small_box", label: "Small box, up to 1 lb" },
  { key: "medium_box", label: "Medium box, up to 3 lb" },
  { key: "large_box", label: "Large box, up to 10 lb" },
];
