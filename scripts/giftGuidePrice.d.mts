export const PRICE_MAX_AGE_DAYS: number;
export function isAmazonHost(h: string | undefined): boolean;
export function verifiedPrice(
  p: { price?: unknown; price_currency?: unknown; price_checked_at?: string; price_source?: unknown; store?: unknown; retailer?: unknown; brand?: unknown },
  hosts: string[],
  store: string | null,
  now?: number,
): { price: number; priceAt: string } | undefined;
