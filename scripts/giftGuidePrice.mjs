/**
 * PRICES on gift-guide picks (owner 11-18), read by scripts/gift-guide-picks.mjs: a pick carries a price only when
 * ~/Desktop/Link-library/fill_prices.py checked it (`price`, `price_currency` "USD", `price_checked_at`, `price_source`)
 * at most PRICE_MAX_AGE_DAYS before the import. NEVER on an Amazon pick (Associates rule: no Amazon price outside its
 * API): a pick whose link or plain link is on an Amazon host, whose store page is store-amazon, or whose store,
 * retailer or brand names Amazon carries none, whatever its file says. Guard: src/test/giftGuidePrices.test.tsx.
 */
export const PRICE_MAX_AGE_DAYS = 3;
const DAY_MS = 86400000;
const louisianaDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(t));
export const isAmazonHost = (h) => /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/.test(h ?? "");

/** { price, priceAt: "YYYY-MM-DD" (Louisiana day of the check) } for a checked, fresh, non-Amazon price; else undefined. */
export function verifiedPrice(p, hosts, store, now = Date.now()) {
  if (p.price == null || p.price === "") return undefined;
  if (store === "store-amazon" || hosts.some(isAmazonHost)) return undefined;
  if ([p.store, p.retailer, p.brand].some((x) => typeof x === "string" && /^amazon\b/i.test(x.trim()))) return undefined;
  const price = typeof p.price === "number" ? p.price : /^\d+(\.\d{1,2})?$/.test(String(p.price).trim()) ? Number(p.price) : NaN;
  const at = Date.parse(p.price_checked_at ?? "");
  if (!(price > 0 && price < 100000) || p.price_currency !== "USD" || !p.price_source || Number.isNaN(at)) return undefined;
  // Older than the limit, or stamped more than an hour in the future: not shown.
  if (now - at > PRICE_MAX_AGE_DAYS * DAY_MS || at - now > DAY_MS / 24) return undefined;
  return { price, priceAt: louisianaDay(at) };
}
