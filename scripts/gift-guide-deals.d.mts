/** Types for scripts/gift-guide-deals.mjs (the deals page's generator; its test imports buildDeals). */
import type { Deal } from "../src/content/giftGuideDeals.mjs";

/** One checked row of scripts/gift-guide-deals-1121.json. */
export interface SourceDeal {
  event: string;
  brand: string;
  deal: string;
  href: string;
  image?: string;
  item?: string;
  code?: string;
  starts?: string;
  ends?: string;
  status?: string;
  store?: string;
  commission?: number;
  source?: string;
  checked?: string;
  seen?: string;
  price?: unknown;
}
export function buildDeals(rows: SourceDeal[], cutouts?: Record<string, string>): Deal[];
export function dealsText(deals: Deal[]): string;
