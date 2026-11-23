/** Types for scripts/giftGuideHimKids1121.mjs (For Him and For Kids = the owner's Amazon and ShopMy saves, 2026-11-21; a few Amazon ones switched to a better-paying ShopMy store). */
export interface HimKids1121Row { name: string; brand: string; line: string; href: string; image: string; store: string; sortPrice: number; price?: number; priceAt?: string; priceFrom?: true; commission: number | null; type: string; code?: string; codeEnds?: string; backOn?: string }
export interface HimKids1121Pick { name: string; brand: string; line: string; href: string; image: string; store: string; price?: number; priceAt?: string; commission: number | null; type: string; ownerPick: true; from: string; priceRank: number | null; rels: string[] }
export const HIM_GUIDE: string;
export const KIDS_GUIDE: string;
export const HIM_KIDS_PRICE_AT: string;
export const HIM_KIDS_STORES: Record<string, string>;
export const HIM_SHOPMY_1121: readonly HimKids1121Row[];
export const HIM_AMAZON_MORE_1121: readonly HimKids1121Row[];
export const KIDS_SHOPMY_1121: readonly HimKids1121Row[];
export const KIDS_AMAZON_MORE_1121: readonly HimKids1121Row[];
export const HIM_1121: readonly HimKids1121Row[];
export const KIDS_1121: readonly HimKids1121Row[];
/** The popular adds of 11-22 (builder-guide-popular): Amazon listings sold by Amazon.com or the brand, priced 11-22. */
export const HIM_POPULAR_1122: readonly HimKids1121Row[];
export const KIDS_POPULAR_1122: readonly HimKids1121Row[];
/** The owner's 11-23 Amazon keeps (scripts/giftGuideOwnerKeeps1123.mjs). */
export const HIM_KEEPS_1123: readonly HimKids1121Row[];
export const KIDS_KEEPS_1123: readonly HimKids1121Row[];
/** Her backyard play saves (11-22, builder-guide-adds-kids). */
export const KIDS_PLAY_1122: readonly HimKids1121Row[];
export function him1121Picks(rows?: readonly HimKids1121Row[]): HimKids1121Pick[];
export function kids1121Picks(rows?: readonly HimKids1121Row[]): HimKids1121Pick[];
export function applyHimKids1121(pageList: Record<string, unknown[]>, storeList?: Record<string, { name: string; hosts: string[] }> | null): Record<string, { before: number; after: number }>;
