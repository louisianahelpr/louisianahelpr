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
  // A web page's own title, not a product (design lead 11-18 PM: "Client Challenge", "Limited Time", a cake named "6").
  if (PAGE_TITLE_NAME.test(first.trim())) return null;
  // A short size or variant after the name stays ("The Quencher H2.0 FlowState Tumbler | 40 OZ" -> "…Tumbler, 40 OZ").
  const variant = kept.slice(1).filter((x) => x.length <= 12 && !PROMO_NAME.test(x) && compact(x) !== compact(first) && !/\b(US|USA|UK)$/.test(x));
  return [first, ...variant].join(", ");
}
/**
 * Thumbnails that show the wrong thing (design audit loop 2026-11-18 PM, ~/.lh-shots/design-audit-loop/gg-wrong-images-1118.json:
 * store logos, banners and favicons standing in for a product, checked by eye on the live pages, 2026-11-18). Matched without the query.
 */
export const WRONG_IMAGES = new Set([
  "https://cdn.prod.website-files.com/615c0fadc8e1d78fcc34e6f0/61957a7123c75c270fea2676_open_graph_image-min.png",
  "https://cdn.shopify.com/s/files/1/0520/7051/4860/files/5e63cf80-efd6-447c-9821-aa9a6e037b55.jpg",
  "https://cdn.shopify.com/s/files/1/0520/7051/4860/files/copper_joe_pink_lifestyle_1.png",
  "https://cdn.shopify.com/s/files/1/0853/0467/2539/files/904643502_10162929993012105_1441846849210934140_n_45dffe6e-d44b-456c-9d35-7d5825726101.jpg",
  "https://cdn.shopify.com/s/files/1/1033/0751/files/LinkSharing-SEO-Thumbnail_1.jpg",
  "https://cdn11.bigcommerce.com/s-4df9uz5/images/stencil/original/carousel/22/shop_all__28122.jpg",
  "https://d3tvemk8zf61cc.cloudfront.net/FB_FBT_logo.jpg",
  "https://images.contentstack.io/v3/assets/blt72739032ac3bdcc6/blta0835708627fd460/602076e937c7bc6afba5213d/Wolfermans-Logo-250x250.jpg",
  "https://images.journeys.com/images/site/1_JourneysUS.png",
  "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/67729fee9a5749b7bc2ab88e0f2c97f4~tplv-fhlh96nyum-crop-webp:800:800.webp",
  "https://res.cloudinary.com/mavely/image/upload/v1654029138/anzdqjqsfz7c7uxx3n05.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1657761519/uouyqlvynadadrvuebhk.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1673364608/Kids_Foot_Locker_logo_90d9ff3bc8.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1688747498/i_Screen_Shoter_Google_Chrome_230707113126_9dc82fd4d6.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1693950711/site_logo_blue_84ee0fe42c.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1694968896/Sonos_logo_c655260285.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1696267560/Tervis_logo_143e880a8f.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1696869768/Champs_logo_1a35ec324d.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1707764960/Black_Rifle_Coffee_Company_logo_f10619ece1.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1744765053/UA_logo_77dc52e99f.png",
  "https://res.cloudinary.com/mavely/image/upload/v1777561906/Capture_34aaf445c7.png",
  "https://warmies.com/cdn/shop/files/favicon.png",
  "https://www.heydude.com/on/demandware.static/Sites-heydude_us-Site/-/default/dwaa3652e0/images/logo-heydude-og-badge.png",
  "https://www.lecreuset.com/dw/image/v2/BDRT_PRD/on/demandware.static/-/Sites-le-creuset-master/default/dw758a39fe/images/cat_cookware_sets/eleven_set_cast_iron_marseille_100.jpg",
  "https://www.yankeecandle.com/mobify/bundle/21709/static/img/global/brand-logo.png",
]);
/** A logo, banner, sprite or icon file, or a site's share/screenshot image, not a product photo (design lead 11-18 PM). */
export const LOGO_IMAGE = /(^|[/_.-])(logos?|banners?|sprites?|icons?)([/_.0-9-]|$)|LinkSharing|SEO-Thumbnail|open_graph_image|\/Capture_|Screen_Shot/i;
/** A logo product's own photo, not a store logo (Black Rifle's 3 Rounds Logo T-Shirt, photo finder 11-18 PM). */
export const LOGO_PRODUCT = /THREE_ROUNDS_LOGO_[A-Z_]*SHIRT/;
/** Image URLs that are no image ("…/Liquid%20error%20(snippets/social-meta-tags…", design audit r2 #8: T3 Micro). */
export const brokenImage = (u) => /liquid(%20|\s|\+)error/i.test(u) || /[<>{}]/.test(u) || SITE_ICON.test(u) || HOTLINK_BLOCKED.test(u)
  || (LOGO_IMAGE.test(u.split("?")[0]) && !LOGO_PRODUCT.test(u)) || WRONG_IMAGES.has(u.split("?")[0]);
/** A site's icon, logo or default share image, not the product (live audit r3 #12: vitamix default-meta-image, kitchenaid bookmark icon). */
export const SITE_ICON = /favicon|apple-touch-icon|bookmark-icon|default-meta-image|meta-image\.|og-badge|\/logo[-_.]/i;
/** Hosts whose product photos do not load on our pages (ORB-blocked or HTTP/2 errors, live audit r3 #12). */
export const HOTLINK_BLOCKED = /^https:\/\/(www\.sephora\.com|www\.rei\.com)\//i;
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
export const GIFT_CARD = /\b(gift ?cards?|e-?gift ?cards?|gift certificates?|gift codes?)\b/i;
export const NOT_A_GIFT = /\b(free trial|try [\w ]*free|membership)\b/i;
export const EXPERIENCE_GUIDES = ["louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "family-fun-days"];
export const KNIFE_OK_GUIDES = ["louisiana-kitchen", "home-cook", "cooks-and-kitchen-staff", "chefs"];
/** Names a web page gives itself: bot walls, error pages, sale banners, store titles, a bare number. */
export const PAGE_TITLE_NAME = /^(client challenge|limited time( offer)?|access denied|just a moment\.*|attention required!?|forbidden|sites-[\w-]+|gifts? shop|\d+)$|official store|something went wrong|country selector|page unavailable/i;
/** Picks that landed in the wrong guide (design lead 11-18 PM): a curling iron in Him, a dumbbell stand in Home Cook, a tea club in Dad. */
/** Subscriptions holds gifts, not free trials or planners (owner 11-18 PM: "Try Prime free", "Audible free trial", the 12-Month Academic Planner off it). */
export const WRONG_GUIDE = { him: /curling iron|hair crimper/i, "home-cook": /dumbbell/i, subscriptions: /free trial|\btry\b.*\bfree\b|\bplanner\b/i, dad: /tea club gift subscription/i };
export const FACE_MASK_OFF = ["home-cook", "baker", "dad", "him", "diyer", "electricians", "mechanics", "construction-workers"];
export const fitsGuide = (slug, p) => {
  if (slug.startsWith("store-")) return true;
  if (WRONG_GUIDE[slug]?.test(p.name)) return false;
  // A beauty mask is no gift for the kitchen or a trade (its source listed every SharkNinja guide).
  if (/\bface mask\b/i.test(p.name) && FACE_MASK_OFF.includes(slug)) return false;
  if (/\bkni(fe|ves)\b/i.test(p.name) && !KNIFE_OK_GUIDES.includes(slug)) return false;
  if (slug === "gift-cards") return GIFT_CARD.test(p.name) && !NOT_A_GIFT.test(p.name);
  if (EXPERIENCE_GUIDES.includes(slug)) return EXPERIENCE.test(p.name) && !NOT_A_GIFT.test(p.name);
  return true;
};

/**
 * A shop listing's SEO title trimmed to a product name (live audit r3 #3: the 140-character Ninja CREAMi title):
 * "BRAND | Product" -> "Product"; a trailing "Holiday And Christmas Gift…", "Gift for Boys & Girls…" or "Stocking
 * Stuffers…" goes; a name still over NAME_MAX is cut at its last ", " or " - " before NAME_MAX, else at a ":", " with " or " for ".
 */
export const NAME_MAX = 70;
export function tidyName(name) {
  let n = String(name ?? "").replace(/\s+/g, " ").trim();
  const piped = /^[A-Z0-9 .&'’-]{2,40} \| (.+)$/.exec(n);
  if (piped) n = piped[1].trim();
  n = n.replace(/\s*[-,–]\s*(holiday and christmas gifts?|christmas gifts?|gifts? for (kids|boys|girls|men|women|him|her)|stocking stuffers?)\b.*$/i, "").trim();
  if (n.length <= NAME_MAX) return n;
  // A list break first, then a "for" / "with" / ":" clause.
  for (const sep of [/, | - /g, /: | with | for /gi]) {
    const cuts = [...n.matchAll(sep)].map((m) => m.index).filter((i) => i >= 12 && i <= NAME_MAX);
    if (cuts.length) return n.slice(0, cuts[cuts.length - 1]).trim();
  }
  return n;
}
