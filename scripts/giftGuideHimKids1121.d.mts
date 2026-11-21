/** Types for scripts/giftGuideHimKids1121.mjs (For Him and For Kids = the owner's Amazon saves, 2026-11-21). */
export interface HimKids1121Row { name: string; brand: string; line: string; href: string; image: string; store: string; sortPrice: number; commission: number; type: string }
export interface HimKids1121Pick { name: string; brand: string; line: string; href: string; image: string; store: string; commission: number; type: string; ownerPick: true; from: string; priceRank: number | null; rels: string[] }
export const HIM_GUIDE: string;
export const KIDS_GUIDE: string;
export const HIM_1121: readonly HimKids1121Row[];
export const KIDS_1121: readonly HimKids1121Row[];
export function him1121Picks(rows?: readonly HimKids1121Row[]): HimKids1121Pick[];
export function kids1121Picks(rows?: readonly HimKids1121Row[]): HimKids1121Pick[];
export function applyHimKids1121(pageList: Record<string, unknown[]>): Record<string, { before: number; after: number }>;
