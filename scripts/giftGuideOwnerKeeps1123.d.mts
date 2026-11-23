/** Types for scripts/giftGuideOwnerKeeps1123.mjs (the owner's 11-23 Amazon keeps). */
export type KeepRow1123 = readonly [asin: string, price: number, image: string, name: string, brand: string, type: string, commission: number, line: string];
export const KEEPS_PRICE_AT: string;
export const HIM_KEEPS_1123_ROWS: readonly KeepRow1123[];
export const KIDS_KEEPS_1123_ROWS: readonly KeepRow1123[];
export const HER_KEEPS_1123_ROWS: readonly KeepRow1123[];
/** [ShopMy pin, price, store photo, name, brand, store, type, commission %, line]. */
export type LinkRow1123 = readonly [pin: string, price: number, image: string, name: string, brand: string, store: string, type: string, commission: number, line: string];
export const HER_LINKS_1123_ROWS: readonly LinkRow1123[];
export const HIM_LINKS_1123_ROWS: readonly LinkRow1123[];
export const KIDS_LINKS_1123_ROWS: readonly LinkRow1123[];
/** [Walmart Creator link, price, Walmart photo, name, brand, type, commission %, line]. */
export const HIM_WALMART_1123_ROWS: readonly KeepRow1123[];
export const HER_WALMART_1123_ROWS: readonly KeepRow1123[];
export const KIDS_WALMART_1123_ROWS: readonly KeepRow1123[];
export const LINKS_CUTOUTS_1123: readonly (readonly [string, string])[];
