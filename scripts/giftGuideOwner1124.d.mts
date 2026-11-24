/** Types for scripts/giftGuideOwner1124.mjs (the owner's 11-24 higher-commission switches and Macy's adds). */
export interface RateSwitch1124 { href: string; store: string; commission: number; price: number; image?: string; name?: string; code?: string; codeEnds?: string; was: string; now: string }
export interface Owner1124Row { name: string; brand: string; line: string; href: string; image: string; store: string; sortPrice: number; price: number; priceAt: string; commission: number; type: string }
/** [ShopMy pin, price, Macy's photo, name, brand, store, type, commission %, line]. */
export type Macys1124Row = readonly [pin: string, price: number, image: string, name: string, brand: string, store: string, type: string, commission: number, line: string];
export const OWNER_1124_PRICE_AT: string;
export const RATE_SWITCHES_1124: Readonly<Record<string, RateSwitch1124>>;
export function rateSwitch1124<T extends { href: string }>(r: T): T;
export const HER_MACYS_1124_ROWS: readonly Macys1124Row[];
export const KIDS_MACYS_1124_ROWS: readonly Macys1124Row[];
export const HER_ADDS_1124: readonly Owner1124Row[];
export const KIDS_ADDS_1124: readonly Owner1124Row[];
export const CUTOUTS_1124: readonly (readonly [string, string])[];
export const STORES_1124: Readonly<Record<string, string>>;
