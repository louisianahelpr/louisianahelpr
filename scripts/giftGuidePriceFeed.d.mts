export const PRICE_FEED_FILE: string;
export function buildPriceFeed(picksDir: string): {
  v: 1;
  items: Record<string, { price: number; at: string; name: string; image?: string; guide: string }>;
};
