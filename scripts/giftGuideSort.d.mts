/** Types for scripts/giftGuideSort.mjs. */
type PickLike = { name: string; brand?: string; href?: string; commission?: number | null; trending?: true; ownerPick?: true };
export const GUIDE_CAP: number;
export const TYPE_MAX: number;
export const THIN_TARGET: number;
export const CROWD_TYPES: Set<string>;
export const CC_SWAP_MARGIN: number;
export const TYPE_RULES: [string, RegExp][];
export const THEME_TYPES: Record<string, Record<string, number>>;
export const LUXURY_BEAUTY: RegExp;
export const NETWORK_RATES: Record<string, number | null>;
export const SECTION_GUIDES: Record<string, string[]>;
export const KNOWN_BRAND: RegExp;
export function pickType(p: { name: string; brand?: string }): string;
export function typeMax(slug: string, type: string): number;
export function amazonBaseRate(p: { name: string; brand?: string }): number | null;
export function walmartRate(p: { name: string; brand?: string }): number;
export function asinOf(href: string): string | null;
export function pinIdOf(href: string): string | null;
export interface RateData {
  pinRate: Map<string, number>;
  hrefRate: Map<string, number>;
  cc: Map<string, { id: string; brand: string; total: number; bonus: number; ends: string; starts: string }>;
  laterRate: Map<string, number>;
  otherRates: Map<string, Record<string, unknown>>;
  clicks: Map<string, number>;
}
export function buildRateData(input?: { shopmyTsv?: string; rowsWithRate?: { href?: string; affiliate_href?: string; commission_pct?: unknown }[]; campaigns?: unknown[]; bestRates?: Record<string, unknown> }): RateData;
export function ccLive(c: { starts?: string; ends?: string } | undefined, today: string): boolean;
export function commissionOf(p: PickLike & { href: string }, data: RateData, today: string): { pct: number | null; source: string };
export function nameWords(name: string, brand?: string): string[];
export function ccTwin(p: PickLike, products: unknown[], data: RateData, today: string, current: number | null): unknown;
export function guideRanks(popularity: unknown, slugs: string[]): Map<string, number>;
export function itemPopularity(p: PickLike, data: RateData, flags?: { trending?: boolean; bestSeller?: boolean }): number;
export function sectionGuides(section: unknown): string[];
export function byCommission<T extends { commission?: number | null; _pop?: number; _at?: number }>(a: T, b: T): number;
