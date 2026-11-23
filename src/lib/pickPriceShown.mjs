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

/**
 * The price section a shown price falls in: ONE rule for the guide page's sections (GiftGuideView.tsx priceSections:
 * "Under $25 (47)", "$25 to $50 (45)") and the page's Q&A counts (src/lib/guideQa.mjs), so a "~$25" gift sits in
 * "$25 to $50" in both (guide audit 1123 #1: the Q&A counted it as under $25, Her 51 beside the page's 47).
 * Guard: src/test/guideAuditFixes1123.test.tsx.
 */
export const PRICE_SECTIONS = [
  // Owner 2026-11-23 (pop-up "Under 10"): every owner-list guide (Her, Him, Kids and their relationship views) opens with
  // "Stocking stuffers under $10", every pick whose card reads under $10, cheapest first; the price sections follow.
  // ONE rule: GiftGuideView.tsx pins this section first (in either price order) and guideQa.mjs counts it.
  // Guard: src/test/giftGuideStockingStuffers1123.test.tsx.
  { id: "stocking-stuffers", max: 10 },
  { id: "under-25", max: 25 },
  { id: "25-to-50", max: 50 },
  { id: "50-to-75", max: 75 },
  { id: "75-to-100", max: 100 },
  { id: "100-and-up", max: Infinity },
];

/** The first section of every owner-list guide (owner 2026-11-23): picks whose card reads under $10. */
export const STOCKING_SECTION_ID = "stocking-stuffers";

/** The section id ("stocking-stuffers", "under-25", "25-to-50", ...) of a shown price, by the dollars the card reads. */
export const priceSectionId = (price) => {
  const dollars = shownDollars(price);
  return PRICE_SECTIONS.find((s) => dollars < s.max).id;
};
