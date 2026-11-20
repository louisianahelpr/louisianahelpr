/** Types for scripts/gift-guide-deals.mjs (the deals guide's generator; its test imports buildDeals). */
import type { Deal } from "../src/content/giftGuideDeals.mjs";

export interface RawDeal {
  brand: string;
  deal_text: string;
  href?: string;
  image?: string;
  featured_item?: string;
  code?: string | null;
  starts?: string | null;
  ends?: string | null;
  status: string;
  needs_link?: boolean;
  deal_works_on_our_link?: boolean;
  source?: string;
  link_store?: string | null;
}
export interface BrandLink { name?: string; href: string; image?: string; commission_pct?: string; store?: string }
export interface DealSources {
  deals: { categories: Record<string, RawDeal[]> };
  brandLinks: Record<string, BrandLink[]>;
  campaigns: { asins?: string[]; total_pct?: number; campaign?: string }[];
  cdn?: Record<string, string>;
}
export function loadSources(dir?: string): DealSources;
export function photoOf(image: string | undefined, cdn?: Record<string, string>): string | undefined;
export function commissionOf(d: RawDeal, src: Pick<DealSources, "brandLinks" | "campaigns">): number;
export function ownStoreLink(d: RawDeal, brandLinks: DealSources["brandLinks"]): BrandLink | null;
export function buildDeals(
  src: DealSources,
  today: string,
): { deals: Deal[]; order: [string, string, number][]; skipped: { noLink: string[]; otherStore: string[]; ended: string[] } };
export function dealsText(deals: Deal[]): string;
