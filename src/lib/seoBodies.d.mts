/** Types for src/lib/seoBodies.mjs (api/share.ts's per-page bodies and JSON-LD). */
export interface SeoPickExtra { image?: string; price?: number; priceAt?: string }
export type SeoPick = [name: string, store: string, href: string, extra?: SeoPickExtra];
export interface SeoGuide {
  name: string;
  /** In the sitemap (GIFT_GUIDE_SEO): index, follow. Any other catalog guide is served noindex. */
  indexed: boolean;
  /** The first SEO_MAX_PICKS picks (name, store, shop link). */
  picks: SeoPick[];
  /** How many picks the guide holds in all (the page's count). */
  count: number;
  related?: [slug: string, name: string][];
}
export interface SeoData {
  guides: Record<string, SeoGuide>;
  /** Old or folded guide slug -> its guide now (301). */
  /** Old slug -> its guide now ("mom"), its section in a merged guide ("healthcare#rns", 1120) or "" (the landing page). */
  moved: Record<string, string>;
  groups: [label: string, guides: [slug: string, name: string][]][];
  /** The deals days' cards: item name, shop link, last day ("" = no end), the day page's slug. */
  deals?: [item: string, href: string, ends: string, event: string][];
}
export interface TownService { slug: string; label: string; pageLabel?: string; phrase: string; category: string }
export interface Town { slug: string; name: string }
export const SEO_SITE_ORIGIN: string;
export function escapeHtml(value: unknown): string;
export function jsonLdScript(data: unknown): string;
export function breadcrumbLd(crumbs: { name: string; path: string }[]): Record<string, unknown>;
export function seoPageBody(crumbs: { name: string; path: string }[], inner: string): string;
export function giftGuideBody(slug: string, guide: SeoGuide): string;
export function dealsGuideBody(slug: string, name: string, intro: string, disclosure: string): string;
export function giftGuideItemListLd(slug: string, guide: SeoGuide, today: string): Record<string, unknown>;
export function dealsItemListLd(name: string, deals: NonNullable<SeoData["deals"]>, today: string, slug: string): Record<string, unknown> | null;
export function giftGuidesLandingBody(groups: SeoData["groups"]): string;
export function giftGuidesLandingLd(groups: SeoData["groups"]): Record<string, unknown>;
export function hireBody(service: TownService, town: Town): string;
export function hireBreadcrumbLd(service: TownService, town: Town): Record<string, unknown>;
export const TWENTY_FIVE_DAYS: { name: string; startDate: string; endDate: string };
export function twentyFiveDaysEventLd(): Record<string, unknown>;
export const INFO_BODY_PATHS: string[];
export function infoPageBody(path: string): string | null;
export function infoPageBreadcrumbLd(path: string): Record<string, unknown> | null;
export function notFoundBody(kind?: "gift-guide" | "hire" | string): string;
