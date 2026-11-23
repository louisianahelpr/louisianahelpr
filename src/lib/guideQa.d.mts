/** Types for src/lib/guideQa.mjs (the guide pages' Q&A, its pre-JS section and its FAQPage JSON-LD). */
export interface QaItem { q: string; a: string }
export interface QaPick { name: string; price?: number; priceAt?: string; priceFrom?: boolean; la?: boolean; brand?: string }
export interface QaDeal { item?: string; event?: string; brand?: string; deal?: string; ends?: string; code?: string }
export interface QaShop { name: string; town?: string; category?: string; ships?: string }
export const QA_PAGES: string[];
export const QA_TITLE: string;
export const QA_BYLINE: { gifts: string; other: string };
export function shortDate(day: string | undefined): string;
export function updatedLine(day: string | undefined): string;
export function toQaPick(p: { name: string; price?: number; priceAt?: string; priceFrom?: boolean; badges?: readonly string[]; brand?: string }): QaPick;
export function catalogGuideQa(slug: string, picks: QaPick[], today: string): QaItem[];
export function dealsDayQa(slug: string, deals: QaDeal[], today: string): QaItem[];
export function smallBizQa(shops: QaShop[], categories: readonly string[]): QaItem[];
export function holidayHubQa(lights: readonly unknown[], events: readonly unknown[], today: string): QaItem[];
export function faqPageLd(qa: QaItem[]): Record<string, unknown> | null;
export function qaSectionHtml(qa: QaItem[], updated: string | undefined, byline: string): string;
export function withQaSection(body: string, section: string): string;
