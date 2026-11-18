/**
 * The gift-guide import's content rules (design audit round 2, 11-18), read by scripts/gift-guide-picks.mjs and
 * guarded by src/test/giftGuideAuditR2.test.ts.
 */
const compact = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * DESIGN AUDIT R2 (11-18). Names: a web page title ("Home | HamiltonBeach.com", "Monthly Fruit Delivery | Fruit of the
 * Month Club | Harry & David") keeps its first part that is not the store; a name that is only a store or brand
 * (Omaha Steaks, Bass Pro Shops), a sale or promo ("Black Friday Sale", "Cyber Monday Beauty Deals 2025"), a page title
 * dated before 2026 ("… Delivered 2024", while a "2027 Planner" is a product) or a guide name is no product, so the pick is hidden. Nothing is renamed beyond cutting those parts off.
 */
export const PROMO_NAME = /\b(black friday|cyber monday|cyber week|sales?|deals?|coupons?|promo(tion)?s?|clearance|free shipping|valid thru|shop now|shop early|shop online|gift guides?|bogo|doorbusters?|savings?)\b|% off|\bbuy \d+,? get\b/i;
/** A year before the 2026 season (written 2026-11-18) in a page title ("… Delivered 2024 | Harry & David"); a product's model year ("Kindle (2024)") stays. */
export const OLD_YEAR = /\b(19\d\d|20[01]\d|202[0-5])\b/;
export const domainName = (s) => /^[\w-]+(\.[\w-]+)*\.(com|net|org|co|us|shop|store)$/i.test(s);
/**
 * A shop's category or collection page named like a product (owner 11-18 PM, Our Top 10): "Kitchen & Cooking Gifts",
 * "DKNY Women's Clothing & Accessories", "The Holiday Collection", "Serums, Cosmetics & Haircare, & More",
 * "Luxury Japanese Skincare Products", "Educational Toys & Learning Toys from …", "Gifts & Value Sets",
 * "Stand Mixer Accessories", "Wolferman's Bakery: English Muffins, Baked Goods & Breakfast Gifts".
 */
export const CATEGORY_NAME = /^(the )?[a-z' ]*collection$|\b\w+ & [\w' ]*\b(gifts|accessories)$|&\s*more$|\btoys & [\w ]*toys\b|\bskincare products$|^gifts & |^[a-z]+( [a-z]+){0,2} accessories$|^[^:\d]+:[^,\d]+,[^&\d]+&[^\d]*$/i;
export const GENERIC_SEGMENT = /^(home|shop|official site|online store|[\w' ]*gifts?)$/i;
export function productName(raw, names, host = "") {
  const bare = (x) => compact(String(x).replace(/\s+(US|USA|UK)$/i, ""));
  const sameAsStore = (x) => names.some((n) => n && bare(n) && bare(n) === bare(x)) || (compact(x).length > 2 && compact(host).includes(compact(x)));
  const parts = String(raw ?? "").replace(/\s+/g, " ").trim().split(/\s*\|\s*|\s+[–—]\s+/).filter(Boolean);
  // A store's home page title starts with the store ("Old Navy | Affordable Clothing…", "Jared | Your Jewelry Store…").
  if (parts.length > 1 && sameAsStore(parts[0].replace(/[®™]/g, ""))) return null;
  const kept = parts.filter((x) => !sameAsStore(x.replace(/[®™]/g, "")) && !domainName(x) && !GENERIC_SEGMENT.test(x.trim()));
  const first = (kept[0] ?? "").trim().replace(/^buy (the )?/i, "");
  // "Jared | Jared": a page titled twice with one word is a store page.
  if (parts.length > 1 && parts.every((x) => compact(x) === compact(parts[0]))) return null;
  if (!first || PROMO_NAME.test(first) || (parts.length > 1 && OLD_YEAR.test(first)) || /^shop\b/i.test(first)) return null;
  // A category page ("Running Shoes, Clothing, & Accessories", "Luxury Organic Bedding, Sheets & Towels") or an error page.
  if ((parts.length > 1 && /,/.test(first) && /&|\band\b/.test(first)) || /not ?found|page not|\b404\b/i.test(first)) return null;
  // ... or one with no comma whose title pairs two plural kinds ("Skincare Routine Tools & LED Face Masks | Shark Beauty",
  // "Food Processors & Choppers Products | KitchenAid US"; owner 11-18 PM saw the first in Our Top 10).
  if (parts.length > 1 && /\b\w+s & [\w' ]*\w+s$/i.test(first)) return null;
  if (CATEGORY_NAME.test(first)) return null;
  // A short size or variant after the name stays ("The Quencher H2.0 FlowState Tumbler | 40 OZ" -> "…Tumbler, 40 OZ").
  const variant = kept.slice(1).filter((x) => x.length <= 12 && !PROMO_NAME.test(x) && compact(x) !== compact(first) && !/\b(US|USA|UK)$/.test(x));
  return [first, ...variant].join(", ");
}
/** Image URLs that are no image ("…/Liquid%20error%20(snippets/social-meta-tags…", design audit r2 #8: T3 Micro). */
export const brokenImage = (u) => /liquid(%20|\s|\+)error/i.test(u) || /[<>{}]/.test(u);
/** Brands a feed spells in the wrong case (design audit r2 #8). */
export const BRAND_CASE = { rei: "REI", ugg: "UGG", laneige: "LANEIGE", xtratuf: "XTRATUF" };
/**
 * "Shop Louisiana" (the louisianaFit flag) is for Louisiana businesses; Muck Boot and XTRATUF are loved here but are
 * not Louisiana businesses (lead decision 11-18, design audit r2 #18): they keep their place in the guides, no badge.
 */
export const NOT_LOUISIANA_BUSINESS = /^(muck ?boot|xtratuf)/i;
/**
 * What a guide may hold (design audit r2 #5, lead 11-18): the Experiences guides hold experiences (tours, tickets,
 * classes, gift cards for them), Gift Cards only gift cards (no free trial or membership), and no knife sits in a
 * general guide (only the kitchen and chef guides and store pages). A pick that does not fit is left out of that guide.
 */
export const EXPERIENCE = /\b(tours?|tickets?|experiences?|class(es)?|workshops?|lessons?|gift ?cards?|e-?gift|gift certificates?|admissions?|passes|pass|cruises?|getaways?|vouchers?|escape rooms?|spa days?)\b/i;
export const GIFT_CARD = /\b(gift ?cards?|e-?gift ?cards?|gift certificates?)\b/i;
export const NOT_A_GIFT = /\b(free trial|try [\w ]*free|membership)\b/i;
export const EXPERIENCE_GUIDES = ["louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "family-fun-days"];
export const KNIFE_OK_GUIDES = ["louisiana-kitchen", "home-cook", "cooks-and-kitchen-staff", "chefs"];
export const fitsGuide = (slug, p) => {
  if (slug.startsWith("store-")) return true;
  if (/\bkni(fe|ves)\b/i.test(p.name) && !KNIFE_OK_GUIDES.includes(slug)) return false;
  if (slug === "gift-cards") return GIFT_CARD.test(p.name) && !NOT_A_GIFT.test(p.name);
  if (EXPERIENCE_GUIDES.includes(slug)) return EXPERIENCE.test(p.name) && !NOT_A_GIFT.test(p.name);
  return true;
};
