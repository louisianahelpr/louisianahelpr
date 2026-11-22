/**
 * Whether a gift-guide pick shows its price on `today` (YYYY-MM-DD, Louisiana), and the dollars it shows. ONE rule for
 * the card (src/components/giftGuides/PickPrice.tsx: "~$24") and the guide's JSON-LD (src/lib/seoBodies.mjs
 * giftGuideItemListLd: an Offer only where the card shows a price, at the same rounded dollars), so structured data
 * never states a price the page does not show (Google: "Don't mark up content that is not visible to readers").
 * A price older than PRICE_MAX_AGE_DAYS is hidden. Plain ESM: api/share.ts imports it through seoBodies.mjs.
 * Holiday audit 1121 (High): the limit was 3 days and nothing refreshes the files on a schedule (prices are re-imported
 * by hand, scripts/gift-guide-picks.mjs), so every price checked Nov 21 went blank on Wed Nov 25, the week of Black
 * Friday, and the price sections and sort fell apart with them. The limit is now 30 days: each list still says "Prices
 * as of <check day>, may change" (PricesAsOf), and scripts/gift-guide-price-age.mjs exits 1 once the newest check is
 * 2+ days old so the refresh is noticed long before anything hides. The import keeps its own 3-day limit
 * (scripts/giftGuidePrice.mjs). Never an invented price.
 * Guard: src/test/giftGuideStructuredData1121.test.ts.
 */
export const PRICE_MAX_AGE_DAYS = 30;

const dayNumber = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;

export function pickPriceShown(price, priceAt, today) {
  if (!price || !(price > 0) || !priceAt || !/^\d{4}-\d{2}-\d{2}$/.test(priceAt)) return false;
  const age = dayNumber(today) - dayNumber(priceAt);
  return age >= 0 && age <= PRICE_MAX_AGE_DAYS;
}

/** The whole dollars a shown price reads as ("~$24"): rounded, at least $1. */
export const shownDollars = (price) => Math.max(1, Math.round(Number(price) || 0));
