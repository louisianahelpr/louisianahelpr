/** Types for scripts/giftGuidePriceRank1121.mjs (the price sort key of Her, Him and Kids, owner 2026-11-21). */
export function hasSortPrice(r: { sortPrice?: unknown }): boolean;
export function rankByPrice<T extends { sortPrice?: unknown }>(rows: readonly T[]): { row: T; priceRank: number | null }[];
export function designWords(row: { name?: unknown; brand?: unknown }): Set<string>;
