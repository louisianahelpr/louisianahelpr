/**
 * The Small Business Saturday page, /gift-guides/small-business-saturday (owner 2026-11-19 ~7:05 PM: "Yes do small
 * business with our small business sponsors"; FOLLOWUP-OWNER-1119.md items 60, 61, 64). Its words, dates and order live
 * here in plain JS, so the page (GiftGuideSmallBiz.tsx), the landing's featured slot, the pre-JS head
 * (giftGuidePageMeta.mjs, api/share.ts), the sitemap and the generator (scripts/gift-guide-small-biz.mjs) read one copy.
 * The businesses are src/content/giftGuideSmallBiz.json (generated; loaded only when the page opens).
 * Never a giveaway day; every card says "25 Days sponsor". Dates are the calendar day in Louisiana.
 * Guard: src/test/giftGuideSmallBiz1120.test.tsx. Types: giftGuideSmallBiz.d.mts.
 */

export const SMALL_BIZ_SLUG = "small-business-saturday";
/** The Shop Small Louisiana guide (merged 1120: Louisiana-Made, Boutiques, Small Businesses, Artists) the page links to. */
export const SHOP_SMALL_GUIDE = "shop-small-louisiana";

/** The landing features the page at its top from this day through FEATURE_TO (owner: Nov 24-29). */
export const SMALL_BIZ_FEATURE_FROM = "2026-11-24";
export const SMALL_BIZ_FEATURE_TO = "2026-11-29";
/** After this day the page is "Shop Small Louisiana" (owner: "then it stays as Shop Small Louisiana"). */
export const SMALL_BIZ_RETITLE_AFTER = "2026-11-29";

/** The category sections, in page order. */
export const SMALL_BIZ_CATEGORIES = ["Food & Sweets", "Home & Decor", "Art & Gifts", "Fashion & Accessories", "Beauty & Wellness", "Kids", "Experiences & Tours", "Services"];

export const SMALL_BIZ_WORDS = {
  title: "Small Business Saturday: Shop Small Louisiana",
  laterTitle: "Shop Small Louisiana",
  lead: "shop small",
  intro:
    "Small Business Saturday is Nov 28. These Louisiana shops and makers are sponsoring our 25 Days of Giveaways, so show them some love: buy a gift, book a visit, or just give them a follow.",
  badge: "25 Days sponsor",
  facebook: "Facebook",
  instagram: "Instagram",
  website: "Website",
  ships: "Ships",
  // Polish audit 1127 #142: "Local" did not say how you get it.
  local: "Pickup in town",
  guideLink: "More Louisiana-made gifts in Shop Small Louisiana",
  featuredLine: "Our 25 Days sponsors: Louisiana shops, makers and local favorites.",
  featuredCta: "Shop small",
  loading: "Loading shops…",
  failed: "The shops didn't load. Check your connection and try again.",
  none: "Our small business list is on its way. Browse the gift guides in the meantime.",
};

/**
 * A sponsor card's gift line without the business's name in front (polish audit 1127 #142: "Gift idea: Ripley's Crawfish
 * gift certificate" under the name "Ripley's Crawfish", on all 38 cards). The name comes off when the gift starts with
 * the whole name (with or without a leading "The"), its first two or more words, or its first word when that is a
 * possessive ("Dupuy's gift certificate"); "Candle flower bouquet" under "Candle Bloom Confections" keeps its word.
 */
export function giftLine(name, gift) {
  const text = String(gift ?? "").trim();
  const words = (s) => s.split(/\s+/).filter(Boolean);
  const nameWords = words(String(name ?? "").replace(/^the\s+/i, ""));
  const giftWords = words(text);
  let n = 0;
  while (n < nameWords.length && n < giftWords.length && nameWords[n].toLowerCase() === giftWords[n].toLowerCase()) n++;
  const strip = n === nameWords.length || n >= 2 || (n === 1 && /['’]s$/i.test(giftWords[0]));
  const rest = strip ? giftWords.slice(n).join(" ") : text;
  if (!rest) return text;
  return rest[0].toUpperCase() + rest.slice(1);
}

/** The calendar day at `now` in Louisiana, "YYYY-MM-DD". */
export function smallBizDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whether the landing features the page on `today` (Nov 24 through Nov 29). */
export function smallBizFeatured(today) {
  return today >= SMALL_BIZ_FEATURE_FROM && today <= SMALL_BIZ_FEATURE_TO;
}

/** The page's title on `today`. */
export function smallBizTitle(today) {
  return today > SMALL_BIZ_RETITLE_AFTER ? SMALL_BIZ_WORDS.laterTitle : SMALL_BIZ_WORDS.title;
}

/** The businesses grouped into their sections, in SMALL_BIZ_CATEGORIES order; empty ones left out. */
export function smallBizSections(rows) {
  return SMALL_BIZ_CATEGORIES.map((category) => ({ category, rows: rows.filter((r) => r.category === category) })).filter((s) => s.rows.length > 0);
}
