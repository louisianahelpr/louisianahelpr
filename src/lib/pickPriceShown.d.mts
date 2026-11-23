export const PRICE_MAX_AGE_DAYS: number;
export function pickPriceShown(price: number | undefined | null, priceAt: string | undefined | null, today: string): boolean;
export function shownDollars(price: number | undefined | null): number;
export type PriceSectionId = "stocking-stuffers" | "under-25" | "25-to-50" | "50-to-75" | "75-to-100" | "100-and-up";
export const PRICE_SECTIONS: readonly { id: PriceSectionId; max: number }[];
export const STOCKING_SECTION_ID: "stocking-stuffers";
export function priceSectionId(price: number | undefined | null): PriceSectionId;
