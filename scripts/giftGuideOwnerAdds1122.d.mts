/** Types for scripts/giftGuideOwnerAdds1122.mjs (the owner's launch-day picks, 2026-11-22). */
export interface OwnerAdd1122Row { name: string; brand: string; line: string; href: string; image: string; store: string; sortPrice: number; price: number; priceAt: string; priceFrom?: true; commission: number | null; type: string; code?: string; codeEnds?: string; backOn?: string }
export const ADDS_PRICE_AT: string;
export const ADDS_STORES_1122: Readonly<Record<string, string>>;
export const HER_ADDS_1122: readonly OwnerAdd1122Row[];
export const KIDS_ADDS_1122: readonly OwnerAdd1122Row[];
export const HIM_ADDS_1122: readonly OwnerAdd1122Row[];
export const ADDS_CUTOUTS_1122: readonly (readonly [string, string])[];
