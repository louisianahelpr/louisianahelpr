/**
 * Whether a gift-guide pick shows its price on `today` (YYYY-MM-DD, Louisiana), and the dollars it shows. ONE rule for
 * the card (src/components/giftGuides/PickPrice.tsx: "~$24") and the guide's JSON-LD (src/lib/seoBodies.mjs
 * giftGuideItemListLd: an Offer only where the card shows a price, at the same rounded dollars), so structured data
 * never states a price the page does not show (Google: "Don't mark up content that is not visible to readers").
 * A price older than PRICE_MAX_AGE_DAYS is hidden. Plain ESM: api/share.ts imports it through seoBodies.mjs.
 * Guard: src/test/giftGuideStructuredData1121.test.ts.
 */
export const PRICE_MAX_AGE_DAYS = 3;

const dayNumber = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;

export function pickPriceShown(price, priceAt, today) {
  if (!price || !(price > 0) || !priceAt || !/^\d{4}-\d{2}-\d{2}$/.test(priceAt)) return false;
  const age = dayNumber(today) - dayNumber(priceAt);
  return age >= 0 && age <= PRICE_MAX_AGE_DAYS;
}

/** The whole dollars a shown price reads as ("~$24"): rounded, at least $1. */
export const shownDollars = (price) => Math.max(1, Math.round(Number(price) || 0));
