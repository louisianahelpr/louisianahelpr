/**
 * /gift-guides: every word, section, code and link rule of the Holiday Gift Guides page lives here; the guides are in
 * giftGuideList.ts and their picks in giftGuideItems/<section>.ts (both generated from her own sources, see their
 * headers). Owner 2026-11-16 "add this to our landing pages"; 2026-11-17 the final layout (gingham header, Shop by
 * budget, fold-out sections with her covers 2 across, discount codes, disclosure), "it should open on my link, not my
 * Pinterest or ShopMy account", "use all the ones that offer commission", and "not shown yet" (the page is a hidden
 * preview: GIFT_GUIDES_PREVIEW below).
 *
 * How a pick becomes a link (one place each, so a change is one line):
 *   - Amazon:  `asin`   -> https://www.amazon.com/dp/<ASIN>?tag=AMAZON_TAG (her website tracking ID).
 *   - ShopMy:  `shopmy` -> https://go.shopmy.us/p-<pin id>, that product's own ShopMy link.
 *   - Brands:  `brand`  -> BRAND_TRACKING[brand] once the lead fills it from CJ / Rakuten, else the brand's own site.
 * Pinterest and her ShopMy shop are SOURCES only; the page never links to pinterest.com, her ShopMy profile, or a
 * ShopMy collection page.
 *
 * Rules (src/test/giftGuidesPage.test.tsx checks them):
 *   - Never invent a product, a price, a code or a claim. No prices on the page; a budget guide's name is the only price
 *     information, and a budget button exists only for a tier one of her guides prices.
 *   - No CBD, vape, alcohol, gambling or prize-draw brand, and no Walmart (owner 2026-11-17): BANNED below.
 *   - Codes go in DISCOUNT_CODES only when the owner or the brand gave them in writing.
 *   - The FTC affiliate disclosure (16 CFR Part 255) and the Amazon Associates statement are on the page.
 *   - Every outbound link gets rel="sponsored noopener" and opens in a new tab (the page draws them all in one place).
 */

/** Her Amazon Associates tracking ID for the website (owner made louisianahelpr-20 for it, 2026-11-17 6:47 PM, via the lead). */
export const AMAZON_TAG = "louisianahelpr-20";
const amazonLink = (asin: string) => `https://www.amazon.com/dp/${asin}?tag=${AMAZON_TAG}`;
const shopmyLink = (pinId: number) => `https://go.shopmy.us/p-${pinId}`;

/**
 * OWNER 2026-11-17: the gift guides are NOT shown yet. /gift-guides sends everyone home; the owner reviews the page at
 * /gift-guides?preview=1 (App.tsx checks the param inline, so this module stays out of the entry chunk). No nav, footer or landing link points here. Going live = drop the gate in App.tsx and put the
 * ways in back (the guard in giftGuidesPage.test.tsx flips with it).
 */
const GIFT_GUIDES_PATH = "/gift-guides";
const GIFT_GUIDES_PREVIEW_PARAM = "preview";
export const GIFT_GUIDES_PREVIEW = `${GIFT_GUIDES_PATH}?${GIFT_GUIDES_PREVIEW_PARAM}=1`;
export const guideHref = (id: string) => `${GIFT_GUIDES_PREVIEW}&guide=${encodeURIComponent(id)}`;

/** Owner 2026-11-17: skip CBD, vape, alcohol, gambling and prize-draw brands; no Walmart (not an affiliate). */
export const BANNED = {
  /** Never in a pick's name, store or brand. */
  words: /\b(cbd|hemp|thc|delta[- ]?[89]|cannabis|marijuana|vapes?|vaping|e-?cig\w*|nicotine|kratom|casino|sportsbook|betting|poker (?:chips?|sets?|tables?)|lottery|sweepstakes?|raffle|giveaway|walmart)\b/i,
  /** An alcoholic drink in a pick's name, unless the pick is clearly barware or a colour name. */
  drink: /\b(wine|whiske?y|bourbon|vodka|tequila|mezcal|rum|gin|liquor|beer|champagne|prosecco|sake|spirits)\b/i,
  barware: /\b(glass|glasses|decanter|shaker|smoker|opener|aerator|chiller|stopper|tumbler|bangles?|pillowsoft|pj|pajamas?)\b/i,
};

export type BrandId = "magnifique";

export interface Brand {
  name: string;
  /** The brand's own site: the link until BRAND_TRACKING has its tracking link. */
  site: string;
  /** One short line: what the brand sells. No claim we have not checked. */
  line: string;
}

export const BRANDS: Record<BrandId, Brand> = {
  magnifique: { name: "Magnifique cookware", site: "https://cookmagnifique.com/", line: "Cookware sets and pans." },
};

/**
 * TODO (lead, before launch): paste a brand's CJ / Rakuten tracking link here from the network dashboard. A brand with
 * null links to its own site until then. Magnifique uses CJ clickless tracking with its code, so the code alone credits
 * the sale.
 */
const BRAND_TRACKING: Record<BrandId, string | null> = { magnifique: null };
export const brandLink = (id: BrandId) => BRAND_TRACKING[id] ?? BRANDS[id].site;

export interface DiscountCode {
  /** Shown name of the brand. */
  name: string;
  code: string;
  /** What the code does, in the brand's own words. */
  offer: string;
  /** Where tapping the brand goes: its guide on this page, or its own (affiliate) site. */
  guide?: string;
  brand?: BrandId;
  /** Where the code was confirmed (kept for the lead; not shown). */
  source: string;
}

/** Only codes confirmed in writing (owner 2026-11-17: LEXI15 Daily Crunch, LEXI10 Magnifique, SECRETBF Canopy). */
export const DISCOUNT_CODES: DiscountCode[] = [
  {
    name: "Daily Crunch",
    code: "LEXI15",
    offer: "15% off sprouted nut snacks.",
    guide: "brand-daily-crunch",
    source: "Owner 2026-11-17 (gift guides handoff): LEXI15, Daily Crunch, 15% off",
  },
  {
    name: "Magnifique cookware",
    code: "LEXI10",
    offer: "10% off. Stacks with eligible promotions.",
    brand: "magnifique",
    source: "Magnifique (David Cairy, CJ), email 2026-11-17 4:34 PM: LEXI10 live, 10% off, stacks with promos",
  },
  {
    name: "Canopy",
    code: "SECRETBF",
    offer: "Black Friday secret sale, up to 50% off.",
    guide: "brand-canopy",
    source: "Owner 2026-11-17 (gift guides handoff): SECRETBF, Canopy, up to 50% off",
  },
];

/** One pick as written in giftGuideItems/<section>.ts: exactly one of asin / shopmy / brand says where it links. */
export interface ItemData {
  name?: string;
  asin?: string;
  shopmy?: number;
  brand?: BrandId;
  /** The store a ShopMy pick sells through. */
  store?: string;
  image?: string;
}

export type GuideSection = "people" | "interests" | "life" | "louisiana" | "christmas" | "deals" | "budget";

export interface GuideMeta {
  id: string;
  section: GuideSection;
  /** Where its picks are sold: an "amazon" guide is all Amazon picks. */
  store: "amazon" | "shopmy";
  /** The small line above the title on her covers ("gifts for the"). */
  lead: string;
  title: string;
  /** Her own cover (a pin, or a cover made with her pin template), as webp under public/gift-guide-covers/. */
  cover: { src: string; w: number; h: number } | null;
  count: number;
}

export interface GiftProduct {
  name: string;
  /** Where it sells: "Amazon", the ShopMy store, or the brand. */
  store: string;
  href: string;
  image?: string;
  code?: DiscountCode;
}

export function toProduct(item: ItemData): GiftProduct {
  if (item.brand) {
    const b = BRANDS[item.brand];
    return { name: b.name, store: b.line, href: brandLink(item.brand), code: DISCOUNT_CODES.find((c) => c.brand === item.brand) };
  }
  if (item.asin) return { name: item.name ?? "", store: "Amazon", href: amazonLink(item.asin), image: item.image };
  if (item.shopmy) return { name: item.name ?? "", store: item.store ?? "", href: shopmyLink(item.shopmy), image: item.image };
  throw new Error(`gift guide item with no link: ${JSON.stringify(item)}`);
}

/** The fold-out sections, in the owner's order (2026-11-17). Budget guides are reached by the budget buttons. */
export const GUIDE_SECTIONS: { id: Exclude<GuideSection, "budget">; title: string }[] = [
  { id: "people", title: "People" },
  { id: "interests", title: "Interests" },
  { id: "life", title: "Life moments" },
  { id: "louisiana", title: "Louisiana" },
  { id: "christmas", title: "Christmas" },
  { id: "deals", title: "Deals and codes" },
];

/**
 * "Shop by budget": the owner's tiers (Under $5 .. $100), each shown only when one of her guides prices it (owner
 * 2026-11-17 "budget tiers only where a price is sourced"). Today her Amazon guides price $10, $25 and $50.
 */
export const BUDGET_TIERS = [5, 10, 15, 20, 25, 30, 50, 100] as const;

export const giftGuides = {
  title: "Holiday Gift Guides",
  kicker: "louisiana helpr",
  bandLine: "Shop our picks",
  intro: "Gift ideas for everyone on your list. Open a section, tap a guide, then tap any gift to shop it.",
  budgetTitle: "Shop by budget",
  under: (n: number) => `Under $${n}`,
  browseTitle: "Browse the guides",
  open: "Close",
  guidesCount: (n: number) => (n === 1 ? "1 guide" : `${n} guides`),
  moreBrands: "More brands",
  disclosure: "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.",
  amazonDisclosure: "As an Amazon Associate we earn from qualifying purchases.",
  priceNote: "Prices change on Amazon, so check the price before you buy.",
  allGuidesLabel: "All gift guides",
  tapLine: "Tap any gift to shop it.",
  picksCount: (n: number) => (n === 1 ? "1 gift" : `${n} gifts`),
  moreGuides: "More guides",
  codesTitle: "Discount codes",
  codesLine: "Tap a code to copy it, then use it at checkout.",
  copyLabel: "Copy",
  copiedLabel: "Copied",
  shopLabel: "Shop",
  loading: "Loading the gifts",
  loadFailed: "The gifts didn't load. Check your connection and try again.",
  retry: "Try again",
  notFound: "That guide isn't here. Pick one from the list.",
};
