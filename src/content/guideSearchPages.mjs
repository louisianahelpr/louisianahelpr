/**
 * Search pages (owner Mon 2026-11-23 ~9:15 PM: "Can you add a lot of different searches so it's seen a lot more"): one
 * Google-friendly page per real holiday search ("gifts for her under $25", "stocking stuffers for men", "gifts for kids
 * ages 3-5"), each a FILTERED VIEW of the live Her, Him and Kids guides (owner 11-21: only those three; no new items, no
 * old guide back, every item exactly as she picked it). A page is only defined when at least SEARCH_PAGE_MIN_PICKS
 * picks honestly match, by data the picks already carry: the price the card shows (whole dollars, the price sections'
 * rule, src/lib/pickPriceShown.mjs), the import's gift `type`, the Kids tag file's maker age
 * (src/content/giftGuideKidsTags.json), or a Louisiana name or brand. No tag is invented here.
 *
 * Each page lives at /gift-guides/<slug> (the guides' own one-segment route and rewrite), with its own <title> (<= 60),
 * description (<= 155), H1 (`lead` + `name`, drawn as the banner like every guide), intro, ItemList, BreadcrumbList,
 * canonical and sitemap entry. Not in the menu or the header: the main guides end with a small "Popular searches" list.
 * The matcher is src/content/guideSearchView.ts; the head src/lib/giftGuidePageMeta.mjs; the pre-JS body
 * src/lib/seoBodies.mjs; the sitemap scripts/generate-sitemap.mjs. Guard: src/test/guideSearchPages1123.test.ts.
 * Types: guideSearchPages.d.mts.
 *
 * `match`: `under` (shown dollars < under), `atLeast` (shown dollars >= atLeast), `types` (the pick's import type is one
 * of these), `ages` (a Kids age band the maker's age covers, giftGuideKidsFilter.ts ageBands), `louisiana` (a Louisiana
 * brand or a Louisiana word in the name). Several keys narrow (AND).
 */

import { SEARCH_PAGE_GUIDES } from "./guideSearchIndex.mjs";
import { SITE_ORIGIN } from "../lib/publicPageMeta.mjs";

/** The fewest picks a search page must honestly hold (owner brief 11-23: "only make a page when >= 8 real items match"). */
export const SEARCH_PAGE_MIN_PICKS = 8;

const BEAUTY = ["skincare", "skincare-set", "hair", "hair-perfume", "hair-towel", "lip", "lip-balm", "makeup", "beauty-device", "fragrance", "hand-care", "lotion", "nail-polish", "nail-file", "body-wash", "body-scrub", "bath-fizzer", "shower-steamers"];
const COZY = ["pajamas", "throw-blanket", "bedding", "heated-bedding", "sweatshirt", "pullover", "sleep-mask", "matching-set", "candle", "candle-warmer", "home-fragrance", "diffuser", "hand-warmer", "mug", "coffee", "matcha-set"];
const HOME_KITCHEN = ["cookware", "cookbook", "kitchen-appliance", "kitchen-knives", "cutting-board", "tray", "vacuum", "cleaning", "food-gift", "food-jar", "coffee", "matcha-set", "mug", "wine-tool", "drinkware", "tumbler", "candle", "home-fragrance", "diffuser", "ornament"];
const JEWELRY_BAGS = ["bag", "jewelry", "jewelry-box", "wallet", "scarf", "eyewear", "accessory", "hat"];
const HUNTING = ["hunting", "duck-call", "trail-camera", "gun-safe", "gun-case", "binoculars", "hand-warmer"];
const FISHING = ["fishing"];
const TECH_HIM = ["earbuds", "headphones", "speaker", "power-bank", "streaming-stick", "smartwatch", "tracker", "camera", "light"];
const GRILLING = ["grilling", "cookware", "seasoning", "knife-sharpener", "cookbook", "boil-paddle", "pizza-oven", "ice-maker", "fire-pit"];
const STYLE_HIM = ["wallet", "belt", "cufflinks", "sunglasses", "shirt", "pullover", "sweater", "jacket", "valet-tray", "boots", "shoes", "socks"];
const GROOMING = ["grooming", "skincare", "soap", "body-wash", "shave", "lotion", "lip-balm", "travel-kit"];
const KIDS_OUTDOOR = ["backyard-play", "outdoor", "ride-on", "scooter", "sports", "fishing", "binoculars", "rocket", "blaster"];
const KIDS_CRAFT = ["craft", "art", "slime", "hair-crayons", "putty", "sensory-sand"];
const KIDS_TECH = ["camera", "audio", "karaoke", "game-console", "digital-pet", "walkie-talkie", "watch", "projector-flashlight"];

/** Every search page's words, in the order the "Popular searches" lists show them (its guides: guideSearchIndex.mjs). */
const DEFS = [
  // ---- Her
  { slug: "gifts-for-her-under-25", lead: "gifts for her", name: "Under $25", h1: "Gifts for her under $25", match: { under: 25 },
    title: "Gifts for her under $25: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for her under $25: beauty, cozy and Louisiana picks she'll actually use, each with its price and a link to the store.",
    intro: "Every gift on our Gifts for Her guide that costs under $25, cheapest first. Each one shows its price and links straight to the store." },
  { slug: "gifts-for-her-under-50", lead: "gifts for her", name: "Under $50", h1: "Gifts for her under $50", match: { under: 50 },
    title: "Gifts for her under $50: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for her under $50, from stocking stuffers to cozy blankets and beauty, each with its price and a link to the store.",
    intro: "Every gift on our Gifts for Her guide that costs under $50. Each one shows its price and links straight to the store that sells it." },
  { slug: "gifts-for-her-under-100", lead: "gifts for her", name: "Under $100", h1: "Gifts for her under $100", match: { under: 100 },
    title: "Gifts for her under $100: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for her under $100: bags, beauty, cozy picks and Louisiana gifts, each with its price and a link to the store.",
    intro: "Every gift on our Gifts for Her guide that costs under $100. Each one shows its price and links straight to the store that sells it." },
  { slug: "luxury-gifts-for-her", lead: "luxury gifts", name: "For Her", h1: "Luxury gifts for her", match: { atLeast: 100 },
    title: "Luxury gifts for her 2026: $100 and up — Helpr",
    description: "Splurge-worthy Christmas gifts for her, $100 and up, from our Gifts for Her guide, each with its price and a link to the store.",
    intro: "The splurge gifts on our Gifts for Her guide, every one $100 and up. Each shows its price and links straight to the store." },
  { slug: "stocking-stuffers-for-women", lead: "stocking stuffers", name: "For Women", h1: "Stocking stuffers for women", match: { under: 10 },
    title: "Stocking stuffers for women 2026: under $10 — Helpr",
    description: "Stocking stuffers for women under $10: lip balm, sheet masks and little treats from our Gifts for Her guide, each with its price.",
    intro: "Every gift on our Gifts for Her guide under $10, small enough for a stocking. Each one shows its price and links to the store." },
  { slug: "beauty-gifts-for-her", lead: "beauty gifts", name: "For Her", h1: "Beauty gifts for her", match: { types: BEAUTY },
    title: "Beauty gifts for her 2026: skincare, hair & lips — Helpr",
    description: "Beauty gifts for her: skincare, hair tools, lip products and fragrance from our Gifts for Her guide, each with its price.",
    intro: "The skincare, hair, lip, fragrance and self-care gifts on our Gifts for Her guide. Each one shows its price and links to the store." },
  { slug: "cozy-gifts-for-her", lead: "cozy gifts", name: "For Her", h1: "Cozy gifts for her", match: { types: COZY },
    title: "Cozy gifts for her 2026: blankets, pajamas & candles — Helpr",
    description: "Cozy Christmas gifts for her: throw blankets, pajamas, candles and warm drinks from our Gifts for Her guide, each with its price.",
    intro: "The blankets, pajamas, candles and other cozy gifts on our Gifts for Her guide. Each one shows its price and links to the store." },
  { slug: "home-gifts-for-mom", lead: "gifts for mom", name: "Home & Kitchen", h1: "Home and kitchen gifts for mom", match: { types: HOME_KITCHEN },
    title: "Gifts for mom 2026: home & kitchen ideas — Helpr",
    description: "Home and kitchen Christmas gifts for mom: cookware, cookbooks, candles and coffee from our Gifts for Her guide, each with its price.",
    intro: "The home, kitchen and coffee gifts on our Gifts for Her guide, for the mom who loves her kitchen. Each one links to the store." },
  { slug: "jewelry-and-bag-gifts-for-her", lead: "jewelry & bags", name: "For Her", h1: "Jewelry and bag gifts for her", match: { types: JEWELRY_BAGS },
    title: "Jewelry & bag gifts for her 2026: wife or girlfriend — Helpr",
    description: "Jewelry, handbags, wallets and accessories for your wife, girlfriend or mom, from our Gifts for Her guide, each with its price.",
    intro: "The jewelry, bags, wallets and accessories on our Gifts for Her guide. Each one shows its price and links straight to the store." },
  { slug: "louisiana-gifts-for-her", lead: "louisiana gifts", name: "For Her", h1: "Louisiana gifts for her", match: { louisiana: true },
    title: "Louisiana gifts for her 2026: Cajun & NOLA picks — Helpr",
    description: "Louisiana Christmas gifts for her: Mignon Faget, Café Du Monde, Saints and New Orleans picks from our Gifts for Her guide.",
    intro: "The Louisiana gifts on our Gifts for Her guide: Louisiana brands and New Orleans, Saints and Cajun picks. Each links to the store." },
  // ---- Him
  { slug: "gifts-for-him-under-25", lead: "gifts for him", name: "Under $25", h1: "Gifts for him under $25", match: { under: 25 },
    title: "Gifts for him under $25: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for him under $25: hunting, fishing, grilling and grooming picks, each with its price and a link to the store.",
    intro: "Every gift on our Gifts for Him guide that costs under $25, cheapest first. Each one shows its price and links straight to the store." },
  { slug: "gifts-for-him-under-50", lead: "gifts for him", name: "Under $50", h1: "Gifts for him under $50", match: { under: 50 },
    title: "Gifts for him under $50: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for him under $50, from stocking stuffers to YETI, hunting and fishing gear, each with its price and a store link.",
    intro: "Every gift on our Gifts for Him guide that costs under $50. Each one shows its price and links straight to the store that sells it." },
  { slug: "gifts-for-him-under-100", lead: "gifts for him", name: "Under $100", h1: "Gifts for him under $100", match: { under: 100 },
    title: "Gifts for him under $100: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for him under $100: boots, coolers, tools and outdoor gear, each with its price and a link to the store.",
    intro: "Every gift on our Gifts for Him guide that costs under $100. Each one shows its price and links straight to the store that sells it." },
  { slug: "luxury-gifts-for-him", lead: "luxury gifts", name: "For Him", h1: "Luxury gifts for him", match: { atLeast: 100 },
    title: "Luxury gifts for him 2026: $100 and up — Helpr",
    description: "Splurge-worthy Christmas gifts for him, $100 and up, from our Gifts for Him guide, each with its price and a link to the store.",
    intro: "The splurge gifts on our Gifts for Him guide, every one $100 and up. Each shows its price and links straight to the store." },
  { slug: "stocking-stuffers-for-men", lead: "stocking stuffers", name: "For Men", h1: "Stocking stuffers for men", match: { under: 10 },
    title: "Stocking stuffers for men 2026: under $10 — Helpr",
    description: "Stocking stuffers for men under $10: hand warmers, fishing lures and keychain tools from our Gifts for Him guide, each with its price.",
    intro: "Every gift on our Gifts for Him guide under $10, small enough for a stocking. Each one shows its price and links to the store." },
  { slug: "hunting-gifts-for-men", lead: "hunting gifts", name: "For Men", h1: "Hunting gifts for men", match: { types: HUNTING },
    title: "Hunting gifts for men 2026: duck calls & gear — Helpr",
    description: "Hunting gifts for the outdoorsman: duck calls, trail cameras, binoculars and hand warmers from our Gifts for Him guide.",
    intro: "The hunting gifts on our Gifts for Him guide, from duck calls to trail cameras. Each one shows its price and links to the store." },
  { slug: "fishing-gifts-for-men", lead: "fishing gifts", name: "For Men", h1: "Fishing gifts for men", match: { types: FISHING },
    title: "Fishing gifts for men 2026: tackle & gear ideas — Helpr",
    description: "Fishing gifts for the fisherman: tackle, lures and gear from our Gifts for Him guide, each with its price and a store link.",
    intro: "The fishing gifts on our Gifts for Him guide, for the man who'd rather be on the water. Each one links straight to the store." },
  { slug: "tech-gifts-for-men", lead: "tech gifts", name: "For Men", h1: "Tech gifts for men", match: { types: TECH_HIM },
    title: "Tech gifts for men 2026: earbuds, speakers & more — Helpr",
    description: "Tech gifts for men: earbuds, speakers, smartwatches and gadgets from our Gifts for Him guide, each with its price.",
    intro: "The tech and gadget gifts on our Gifts for Him guide. Each one shows its price and links straight to the store that sells it." },
  { slug: "grilling-gifts-for-dad", lead: "gifts for dad", name: "Grilling & Cooking", h1: "Grilling gifts for dad", match: { types: GRILLING },
    title: "Grilling gifts for dad 2026: cast iron & seasoning — Helpr",
    description: "Grilling and cooking gifts for dad: cast iron, seasonings, a Cajun cookbook and outdoor cooking gear from our Gifts for Him guide.",
    intro: "The grilling, cast iron and cooking gifts on our Gifts for Him guide, for the dad who runs the pit. Each one links to the store." },
  { slug: "gifts-for-husband", lead: "gifts for husband", name: "Classic Style", h1: "Classic style gifts for your husband", match: { types: STYLE_HIM },
    title: "Gifts for husband 2026: wallets, boots & style — Helpr",
    description: "Classic style gifts for your husband or boyfriend: wallets, belts, cufflinks, boots and shirts from our Gifts for Him guide.",
    intro: "The wallets, belts, boots, shirts and other classic style gifts on our Gifts for Him guide. Each one links straight to the store." },
  { slug: "grooming-gifts-for-men", lead: "grooming gifts", name: "For Men", h1: "Grooming gifts for men", match: { types: GROOMING },
    title: "Grooming gifts for men 2026: skincare & shave — Helpr",
    description: "Grooming gifts for men: skincare, soap, shave and travel kits from our Gifts for Him guide, each with its price and a store link.",
    intro: "The grooming, skincare and shave gifts on our Gifts for Him guide. Each one shows its price and links straight to the store." },
  { slug: "louisiana-gifts-for-him", lead: "louisiana gifts", name: "For Him", h1: "Louisiana gifts for him", match: { louisiana: true },
    title: "Louisiana gifts for him 2026: Cajun, LSU & NOLA — Helpr",
    description: "Louisiana Christmas gifts for him: LSU, Saints, Cajun seasoning and New Orleans picks from our Gifts for Him guide.",
    intro: "The Louisiana gifts on our Gifts for Him guide: LSU and Saints gear, Cajun cooking and Louisiana brands. Each links to the store." },
  // ---- Kids
  { slug: "gifts-for-toddlers", lead: "gifts for toddlers", name: "Ages 0–2", h1: "Gifts for babies and toddlers (ages 0–2)", match: { ages: ["baby"] },
    title: "Gifts for toddlers 2026: baby & 1-2 year olds — Helpr",
    description: "Christmas gifts for babies and toddlers up to age 2, by the maker's own recommended age, from our Gifts for Kids guide.",
    intro: "The gifts on our Gifts for Kids guide whose maker recommends them for ages 0 to 2. Each one shows its price and links to the store." },
  { slug: "gifts-for-kids-ages-3-5", lead: "gifts for kids", name: "Ages 3–5", h1: "Gifts for kids ages 3–5", match: { ages: ["3-5"] },
    title: "Gifts for kids ages 3-5: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for preschoolers ages 3 to 5, by the maker's own recommended age, from our Gifts for Kids guide.",
    intro: "The gifts on our Gifts for Kids guide whose maker recommends them for ages 3 to 5. Each one shows its price and links to the store." },
  { slug: "gifts-for-kids-ages-6-8", lead: "gifts for kids", name: "Ages 6–8", h1: "Gifts for kids ages 6–8", match: { ages: ["6-8"] },
    title: "Gifts for kids ages 6-8: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for kids ages 6 to 8, by the maker's own recommended age, from our Gifts for Kids guide, each with its price.",
    intro: "The gifts on our Gifts for Kids guide whose maker recommends them for ages 6 to 8. Each one shows its price and links to the store." },
  { slug: "gifts-for-kids-ages-9-12", lead: "gifts for kids", name: "Ages 9–12", h1: "Gifts for kids ages 9–12", match: { ages: ["9-12"] },
    title: "Gifts for kids ages 9-12 & tweens: Christmas 2026 — Helpr",
    description: "Christmas gifts for kids and tweens ages 9 to 12, by the maker's own recommended age, from our Gifts for Kids guide.",
    intro: "The gifts on our Gifts for Kids guide whose maker recommends them for ages 9 to 12. Each one shows its price and links to the store." },
  { slug: "gifts-for-teens", lead: "gifts for teens", name: "Ages 13+", h1: "Gifts for teens", match: { ages: ["teens"] },
    title: "Gifts for teens 2026: Christmas ideas for 13+ — Helpr",
    description: "Christmas gifts for teens 13 and up, by the maker's own recommended age, from our Gifts for Kids guide, each with its price.",
    intro: "The gifts on our Gifts for Kids guide whose maker recommends them for teens. Each one shows its price and links to the store." },
  { slug: "kids-gifts-under-25", lead: "kids gifts", name: "Under $25", h1: "Kids gifts under $25", match: { under: 25 },
    title: "Kids gifts under $25: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for kids under $25: books, crafts, plush and stocking stuffers from our Gifts for Kids guide, each with its price.",
    intro: "Every gift on our Gifts for Kids guide that costs under $25, cheapest first. Each one shows its price and links to the store." },
  { slug: "kids-gifts-under-50", lead: "kids gifts", name: "Under $50", h1: "Kids gifts under $50", match: { under: 50 },
    title: "Kids gifts under $50: Christmas 2026 ideas — Helpr",
    description: "Christmas gifts for kids under $50: toys, games, crafts and books from our Gifts for Kids guide, each with its price and store link.",
    intro: "Every gift on our Gifts for Kids guide that costs under $50. Each one shows its price and links straight to the store that sells it." },
  { slug: "outdoor-toys-for-kids", lead: "outdoor toys", name: "For Kids", h1: "Outdoor toys for kids", match: { types: KIDS_OUTDOOR },
    title: "Outdoor toys for kids 2026: backyard & ride-ons — Helpr",
    description: "Outdoor Christmas gifts for kids: backyard play, scooters, ride-ons and sports from our Gifts for Kids guide, each with its price.",
    intro: "The backyard, ride-on, scooter and sports gifts on our Gifts for Kids guide. Each one shows its price and links to the store." },
  { slug: "arts-and-crafts-gifts-for-kids", lead: "arts & crafts", name: "For Kids", h1: "Arts and crafts gifts for kids", match: { types: KIDS_CRAFT },
    title: "Arts & crafts gifts for kids 2026: kits & slime — Helpr",
    description: "Arts and crafts Christmas gifts for kids: craft kits, art sets, slime and putty from our Gifts for Kids guide, each with its price.",
    intro: "The craft kits, art sets, slime and other creative gifts on our Gifts for Kids guide. Each one shows its price and links to the store." },
  { slug: "tech-gifts-for-kids", lead: "tech gifts", name: "For Kids", h1: "Tech gifts for kids", match: { types: KIDS_TECH },
    title: "Tech gifts for kids 2026: cameras, karaoke & more — Helpr",
    description: "Tech Christmas gifts for kids: kid cameras, audio players, karaoke and game consoles from our Gifts for Kids guide.",
    intro: "The kid cameras, audio players, karaoke machines and game consoles on our Gifts for Kids guide. Each one links to the store." },
  // ---- Mixed (every listed guide's picks, each gift once)
  { slug: "stocking-stuffers-under-10", lead: "stocking stuffers", name: "Under $10", h1: "Stocking stuffers under $10", match: { under: 10 },
    title: "Stocking stuffers under $10: 2026 ideas for all — Helpr",
    description: "Stocking stuffers under $10 for her, him and kids, from our three gift guides, each with its price and a link to the store.",
    intro: "Every gift under $10 on our Gifts for Her, Gifts for Him and Gifts for Kids guides, in one list. Each one links to the store." },
  { slug: "secret-santa-gifts-under-25", lead: "secret santa gifts", name: "Under $25", h1: "Secret Santa and white elephant gifts under $25", match: { under: 25 },
    title: "Secret Santa & white elephant gifts under $25 — Helpr",
    description: "Secret Santa and white elephant gifts under $25 for coworkers, friends and family, from our Her and Him guides, each with its price.",
    intro: "Every gift under $25 on our Gifts for Her and Gifts for Him guides, for the office Secret Santa or a white elephant swap." },
  { slug: "gifts-for-coworkers-under-15", lead: "gifts for coworkers", name: "Under $15", h1: "Gifts for coworkers under $15", match: { under: 15 },
    title: "Gifts for coworkers under $15: Christmas 2026 — Helpr",
    description: "Small Christmas gifts for coworkers under $15, from our Gifts for Her and Gifts for Him guides, each with its price and store link.",
    intro: "Every gift under $15 on our Gifts for Her and Gifts for Him guides, easy to pick up for the whole office. Each links to the store." },
  { slug: "louisiana-christmas-gifts", lead: "louisiana", name: "Christmas Gifts", h1: "Louisiana Christmas gifts", match: { louisiana: true },
    title: "Louisiana Christmas gifts 2026: Cajun, LSU & NOLA — Helpr",
    description: "Louisiana Christmas gifts for her, him and kids: Cajun books, LSU and Saints gear, New Orleans jewelry and Louisiana food gifts.",
    intro: "Every Louisiana gift on our Gifts for Her, Gifts for Him and Gifts for Kids guides: Louisiana brands and Cajun, LSU, Saints and New Orleans picks." },
];

/** Every search page: its words and the guides it reads. */
export const SEARCH_PAGES = DEFS.map((d) => ({ ...d, guides: SEARCH_PAGE_GUIDES[d.slug] ?? [] }));

/** A search page by its slug, or null. */
export const searchPageBySlug = (slug) => SEARCH_PAGES.find((p) => p.slug === slug) ?? null;

/** The search pages that draw on `guide` ("her"), for that guide's "Popular searches" list. */
export const searchPagesOf = (guide) => SEARCH_PAGES.filter((p) => p.guides.includes(guide));

/** The guide a search page's breadcrumb and "See the full guide" link name: its one guide, or null for a mixed page. */
export const searchPageParent = (page) => (page.guides.length === 1 ? page.guides[0] : null);

/** The main guides' names for the links back (the guides' own SEO names, src/content/giftGuideSeo.mjs). */
export const SEARCH_GUIDE_NAMES = { her: "Gifts for Her", him: "Gifts for Him", kids: "Gifts for Kids" };

/** Up to `n` sibling search pages to cross-link from `page`: same guide first, then the mixed pages. */
export function searchPageSiblings(page, n = 8) {
  const same = SEARCH_PAGES.filter((p) => p.slug !== page.slug && p.guides.some((g) => page.guides.includes(g)));
  const first = same.filter((p) => p.guides.length === page.guides.length);
  return [...new Set([...first, ...same])].slice(0, n);
}

/** A search page's head: its own keyword title (<= 60), description (<= 155) and canonical, indexed; og:title is its H1. */
export function searchPageMeta(page) {
  return { title: page.title, description: page.description, canonical: `${SITE_ORIGIN}/gift-guides/${page.slug}`, ogTitle: page.h1, ogDescription: page.description };
}
