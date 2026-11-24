/** Types for scripts/giftGuideSteals1124.mjs (the Black Friday steals the owner ticked for the guides, 11-24). */
/** [link, price, store photo, name, brand, store, type, commission %, line]. */
export type Steal1124Row = readonly [href: string, price: number, image: string, name: string, brand: string, store: string, type: string, commission: number, line: string];
export const HER_STEALS_1124_ROWS: readonly Steal1124Row[];
export const HIM_STEALS_1124_ROWS: readonly Steal1124Row[];
export const KIDS_STEALS_1124_ROWS: readonly Steal1124Row[];
export const STEALS_CUTOUTS_1124: readonly (readonly [string, string])[];
