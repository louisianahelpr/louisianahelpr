/**
 * FOR HER + FOR HIM, SORTED BY INTEREST (owner decision by pop-up, 2026-11-20 ~6:50 PM). The people guides are two
 * guides now, each in five interest sections:
 *   - For Her (/gift-guides/her): mom, wife, girlfriend, sister and mother-in-law;
 *   - For Him (/gift-guides/him): dad, husband, boyfriend, brother and father-in-law.
 * Relationship chips at the top of each guide FILTER the same list by each pick's `rels` tags (written by the import,
 * scripts/giftGuidePeople1120.mjs). Each relationship keeps its own page for search engines (/gift-guides/mom,
 * /gift-guides/dad, /gift-guides/wife ...): the guide filtered to that relationship, with its own H1, title, meta and
 * canonical. Grandparents, Kids and Teens stay separate guides.
 *
 * Read by the import (sections, sources, tags), the page catalog (src/content/giftGuideCatalog.ts: the relationship
 * pages and the old links), and the sitemap (through GIFT_GUIDE_SEO). Guard: src/test/giftGuidePeople1120.test.ts.
 */

/**
 * The two guides: the old guides whose picks they take (`sources`, by the pick's `from`), their interest sections in
 * page order, and their relationships (`rels`: the chip, its own page's slug and the old guides it came from).
 * `mature`: an in-law (and grandparent-age) page, which leaves out boots and anything too young or trendy.
 * `partner`: only a partner's page shows a romantic pick.
 */
export const PEOPLE_GUIDES = [
  {
    slug: "her",
    title: "Her",
    sources: ["her", "mom", "mother-in-law", "wife", "girlfriend", "sister", "big-sisters", "sister-in-law"],
    sections: [
      { id: "cozy-and-loungewear", title: "Cozy & Loungewear" },
      { id: "beauty-and-self-care", title: "Beauty & Self-Care" },
      { id: "home-and-candles", title: "Home & Candles" },
      { id: "style-and-accessories", title: "Style & Accessories" },
      { id: "under-25", title: "Under $25" },
    ],
    rels: [
      { slug: "mom", label: "Mom", from: ["mom"] },
      { slug: "wife", label: "Wife", from: ["wife"], partner: true },
      { slug: "girlfriend", label: "Girlfriend", from: ["girlfriend"], partner: true },
      { slug: "sister", label: "Sister", from: ["sister", "big-sisters", "sister-in-law"] },
      { slug: "mother-in-law", label: "Mother-in-law", from: ["mother-in-law"], mature: true },
    ],
  },
  {
    slug: "him",
    title: "Him",
    sources: ["him", "dad", "father-in-law", "boyfriend-or-husband", "brother", "brother-in-law"],
    sections: [
      { id: "outdoors", title: "Outdoors (Hunting & Fishing)" },
      { id: "grilling-and-kitchen", title: "Grilling & Kitchen" },
      { id: "tech-and-gadgets", title: "Tech & Gadgets" },
      { id: "classic-style", title: "Classic Style" },
      { id: "under-25", title: "Under $25" },
    ],
    rels: [
      { slug: "dad", label: "Dad", from: ["dad"] },
      { slug: "husband", label: "Husband", from: ["boyfriend-or-husband"], partner: true },
      { slug: "boyfriend", label: "Boyfriend", from: ["boyfriend-or-husband"], partner: true },
      { slug: "brother", label: "Brother", from: ["brother", "brother-in-law"] },
      { slug: "father-in-law", label: "Father-in-law", from: ["father-in-law"], mature: true },
    ],
  },
];

/**
 * The owner's own lists (owner 2026-11-21, For Her = her 25 saves, scripts/giftGuideHer1121.mjs): ONE flat list, so the
 * page shows no relationship chips and no deals-and-codes box on these guides or their relationship pages (/mom ...).
 */
export const OWNER_LIST_GUIDES = ["her", "him", "kids"];
/** True when `slug` (a guide, or a relationship page such as "mom") shows one of the owner's own lists. */
const relationPageGuide = (slug) => PEOPLE_GUIDES.find((g) => g.rels.some((r) => r.slug === slug))?.slug ?? slug;
export const isOwnerList = (slug) => OWNER_LIST_GUIDES.includes(relationPageGuide(slug));

/** The most picks one interest section shows, and of one gift type in it (owner 11-19/11-20). */
export const PEOPLE_SECTION_CAP = 25;
export const PEOPLE_TYPE_MAX = 2;
/** Under $25 needs at least this many good picks on each guide (owner 11-20: "Dad had zero gifts under $25"). */
export const PEOPLE_UNDER_25_MIN = 8;

/** Relationship page slug -> { guide, label }: /gift-guides/mom is For Her filtered to Mom. */
export const RELATION_PAGES = Object.fromEntries(PEOPLE_GUIDES.flatMap((g) => g.rels.map((r) => [r.slug, { guide: g.slug, label: r.label }])));

/**
 * Old people-guide links that are no relationship page of their own -> where they open now (each answers a 301 on the
 * server, api/share.ts, through the catalog's newSlugFor).
 */
export const OLD_PEOPLE_SLUGS = { "boyfriend-or-husband": "husband", "big-sisters": "sister", "sister-in-law": "sister", "brother-in-law": "brother" };

/**
 * The old section anchors on the people guides (/gift-guides/her#wife, /gift-guides/mom#mother-in-law) -> the page they
 * open now. A hash never reaches the server, so the page forwards these (GiftGuides.tsx).
 */
export const OLD_PEOPLE_ANCHORS = {
  her: { wife: "wife", girlfriend: "girlfriend", "top-picks": "her" },
  mom: { "mother-in-law": "mother-in-law", "top-picks": "mom" },
  him: { "boyfriend-or-husband": "husband", "top-picks": "him" },
  dad: { "father-in-law": "father-in-law", "top-picks": "dad" },
  family: { siblings: "sister" },
};

/** The people guide a guide or relationship page belongs to ("mom" -> "her"), or null. */
export const peopleGuideOf = (slug) => (PEOPLE_GUIDES.some((g) => g.slug === slug) ? slug : RELATION_PAGES[slug]?.guide ?? null);
