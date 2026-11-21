/** Types for scripts/gift-guide-sponsor-logos.mjs (sponsor logos and spots for the gift guides). */
export const DROPPED_SPONSORS: Set<string>;
export const fold: (s: unknown) => string;
export const sponsorSlug: (name: unknown) => string;
export const shortName: (name: unknown) => string;
export function readLineup(src: string): any;
export function readIndex(text: string): any;
export const logoFor: (brand: any, index: any, files?: string[]) => any;
export function spotFor(brand: any, chunks: any): any;
/** Owner 2026-11-21: scripts/gift-guide-sponsor-order-1121.json (unconfirmed sponsors, national ones, gift values). */
export const SPONSOR_ORDER: { notConfirmed: string[]; national: string[]; value: Record<string, number> };
export const NOT_CONFIRMED: Set<string>;
export const sponsorRowOrder: (a: { name: string; group?: string }, b: { name: string; group?: string }) => number;
