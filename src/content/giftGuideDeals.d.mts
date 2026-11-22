/** Types for src/content/giftGuideDeals.mjs (the Black Friday, Small Business Saturday & Cyber Monday deals page). */
export interface Deal {
  /** The section: "black-friday" or "cyber-monday" (DEAL_EVENTS ids of kind "deals"). */
  event: string;
  brand: string;
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
  /** "live": seen on the brand's site; "announced": the brand told us, its card says "Starts <day>" until then. */
  status: "live" | "announced";
  /** The store the link opens when it is not the brand's own site ("Amazon"). */
  store?: string;
}
export interface DealEvent {
  id: string;
  kind: "deals" | "small-biz";
  /** YYYY-MM-DD (Louisiana). */
  day: string;
  title: string;
  /** The day page's banner title ("Black Friday Deals"). */
  pageTitle: string;
  lead: string;
  description: string;
  before: string;
  on: string;
  after: string;
}
export const DEALS_SLUG: string;
export const DEALS_COVER: string;
export const FEATURE_FROM: string;
export const FEATURE_TO: string;
export const RETITLE_AFTER: string;
export const DEAL_EVENTS: readonly DealEvent[];
export const DEAL_DAY_SLUGS: readonly string[];
export function dealDay(slug: string | undefined): DealEvent | null;
export function oldDealsTarget(hash: string): string;
export function codesDay(event: Pick<DealEvent, "day">, today: string): string;
export const DEALS_PER_BRAND: number;
export const DEALS_WORDS: {
  title: string;
  laterTitle: string;
  disclosure: string;
  featuredLine: string;
  featuredCta: string;
  shop: (brand: string) => string;
  shopShort: string;
  codeLabel: string;
  endsOn: (ymd: string) => string;
  startsOn: (ymd: string) => string;
  shopSmall: string;
  none: string;
  noneCta: string;
  loading: string;
};
export function shortDay(ymd: string): string;
export function louisianaDay(now: Date): string;
/** A store code with its expiry (the discount codes list): only `store`, `code` and `expires` are read. */
export interface CodeExpiry { store: string; code: string; expires?: string }
export function dealEnds(deal: Pick<Deal, "ends" | "code" | "brand">, codes?: readonly CodeExpiry[]): string | undefined;
export function dealCode(deal: Pick<Deal, "code" | "brand">, today: string, codes?: readonly CodeExpiry[]): string | undefined;
export function dealShows(deal: Pick<Deal, "ends" | "code" | "brand">, today: string, codes?: readonly CodeExpiry[]): boolean;
export function dealStartsLater(deal: Pick<Deal, "starts" | "status">, today: string): boolean;
export function liveDeals<T extends Pick<Deal, "ends" | "code" | "brand">>(deals: readonly T[], today: string, codes?: readonly CodeExpiry[]): T[];
export function eventPhase(event: Pick<DealEvent, "day">, today: string): "before" | "on" | "after";
export function eventOrder(today: string): DealEvent[];
export function dealsIn<T extends Pick<Deal, "event">>(deals: readonly T[], eventId: string): T[];
export function dealsFeatured(today: string): boolean;
export function dealsTitle(today: string): string;
export function dealName(d: Deal): string;
