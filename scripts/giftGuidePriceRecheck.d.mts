export const PRICE_RECHECKS: Record<string, { price: number; priceAt: string }>;
/** A price that is not exactly the entry's (including a missing one) never moves the day. */
export function recheckedPriceAt(href: string, price: unknown, priceAt: string): string;
