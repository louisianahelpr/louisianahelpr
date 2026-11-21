/** Types for scripts/giftGuideHer1121.mjs (For Her = the owner's 25 saves, 2026-11-21). */
export interface Her1121Row { name: string; brand: string; line: string; href: string; image: string; store: string; sortPrice: number; price?: number; commission: number | null; type: string }
export interface Her1121Pick { name: string; brand: string; line: string; href: string; image: string; store: string; price?: number; priceAt?: string; commission: number | null; type: string; ownerPick: true; from: string; rels: string[] }
export const HER_GUIDE: string;
export const HER_PRICE_AT: string;
export const HER_STORES: Readonly<Record<string, string>>;
export const HER_1121: readonly Her1121Row[];
export function her1121Picks(rows?: readonly Her1121Row[]): Her1121Pick[];
export function applyHer1121(pageList: Record<string, unknown[]>, storeList: Record<string, { name: string; hosts: string[] }>): { before: number; after: number; addedStores: string[]; putBack: string[] };
