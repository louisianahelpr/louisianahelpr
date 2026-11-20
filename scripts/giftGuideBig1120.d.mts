/** Types for scripts/giftGuideBig1120.mjs (the gift guides' big batch 1120 import rules). */
type Row = Record<string, unknown> & { name: string; brand?: string; href?: string; color?: string | null; commission?: number };
export const BIG1120_DROP: RegExp[];
export const PREORDER_BRANDS: string[];
export const BRAND_CODES: Record<string, { code: string; offer: string }>;
export const RENAME_1120: Record<string, string>;
export const CC_1120: string;
export const CUTS_1120: { guide: string; href?: string; item: string; why: string }[];
export function sameProduct(a: Row, b: Row): boolean;
export function colorOf(r: Row): string;
export function parseSwaps(text: string): { swaps: { guide: string; remove: string; add: string }[]; out: { guide: string; item: string }[] };
export function importRows1120(readJson: (file: string) => unknown, rowsOf: (v: unknown) => unknown[], dir: string): (Row & { _file: string; _source: string; _forced?: true; tiktok?: true; preorder?: true; code?: string })[];
export function swapCuts(dir: string): { guide: string; item: string; why: string }[];
export function budgetBand(raw: unknown): 25 | 50 | 100 | 500 | undefined;
export function productKey1120(brand: string | undefined, name: string, dedupeKey: (n: string) => string): string;
