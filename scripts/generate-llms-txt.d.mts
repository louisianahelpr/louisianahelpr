/** Types for scripts/generate-llms-txt.mjs (public/llms.txt). */
export function sitemapPaths(xml: string): string[];
export function isHolidayPath(path: string): boolean;
export function buildLlmsTxt(xml: string): string;
export function storeNames(picksTs: string, catalogTs: string): Record<string, string>;
export function themeGuideMeta(slug: string, chunk: { picks?: { name?: string; href?: string; price?: number; priceAt?: string; priceFrom?: boolean; store?: string }[] } | null | undefined, stores: Record<string, string>): ReturnType<typeof import("../src/lib/giftGuidePageMeta.mjs").giftGuidePageMeta> | null;
