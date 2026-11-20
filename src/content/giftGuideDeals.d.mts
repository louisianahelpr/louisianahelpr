/** Types for src/content/giftGuideDeals.mjs (the Black Friday & Cyber Monday deals guide). */
export interface Deal {
  brand: string;
  category: string;
  /** The sale in the brand's own words, shortened ("50% off sitewide"). */
  deal: string;
  href: string;
  image?: string;
  /** The product the photo shows. */
  item?: string;
  code?: string;
  /** YYYY-MM-DD (Louisiana). */
  starts?: string;
  ends?: string;
  /** "live": seen on the brand's site; "announced": the brand told us, shown only from `starts`. */
  status: "live" | "announced";
  /** The store the link opens when it is not the brand's own site ("Amazon"). */
  store?: string;
}
export const DEALS_SLUG: string;
export const FEATURE_FROM: string;
export const FEATURE_TO: string;
export const RETITLE_AFTER: string;
export const DEALS_WORDS: {
  title: string;
  laterTitle: string;
  lead: string;
  intro: string;
  disclosure: string;
  featuredLine: string;
  featuredCta: string;
  shop: (brand: string) => string;
  codeLabel: string;
  endsOn: (ymd: string) => string;
  startsOn: (ymd: string) => string;
  none: string;
  noneCta: string;
  loading: string;
};
export const DEAL_CATEGORIES: readonly string[];
export const DEALS_PER_SECTION: number;
export function shortDay(ymd: string): string;
export function louisianaDay(now: Date): string;
export function dealShows(deal: Pick<Deal, "ends" | "starts" | "status">, today: string): boolean;
export function liveDeals<T extends Pick<Deal, "ends" | "starts" | "status">>(deals: readonly T[], today: string): T[];
export function dealSections<T extends Pick<Deal, "category">>(deals: readonly T[]): { category: string; deals: T[] }[];
export function dealsFeatured(today: string): boolean;
export function dealsTitle(today: string): string;
