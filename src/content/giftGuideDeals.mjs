/**
 * The Black Friday & Cyber Monday deals guide, /gift-guides/black-friday-cyber-monday (owner 2026-11-19: "You can
 * build the rest of the Black Friday and Cyber Monday guides asap"; live by Mon Nov 23). Its words, its dates and the
 * rules that hide a deal live here, in plain JS, so the page (GiftGuideDeals.tsx), the landing's featured slot, the
 * pre-JS head (giftGuidePageMeta.mjs, api/share.ts) and the generator (scripts/gift-guide-deals.mjs) all read one copy.
 * The deals themselves are src/content/giftGuideDeals.json (generated; loaded only when the page opens).
 * Every date is the calendar day in Louisiana (America/Chicago), whatever the visitor's own zone.
 * Guard: src/test/giftGuideDeals1119.test.tsx. Types: giftGuideDeals.d.mts.
 */

export const DEALS_SLUG = "black-friday-cyber-monday";

/** The landing features the guide at its top from this day through FEATURE_TO (owner brief 2026-11-19). */
export const FEATURE_FROM = "2026-11-23";
export const FEATURE_TO = "2026-12-01";
/** After this day the guide is "Holiday Deals" (Cyber Monday is Nov 30; the brief keeps the name through Dec 1). */
export const RETITLE_AFTER = "2026-12-01";

export const DEALS_WORDS = {
  title: "Black Friday & Cyber Monday Deals",
  laterTitle: "Holiday Deals",
  lead: "the best",
  intro:
    "Y'all, the big sales are here. We checked each deal on the brand's own site, so you can knock out your list and still save a little for the gumbo pot.",
  disclosure: "#ad, some links earn us a small commission.",
  featuredLine: "Hand-checked sales from brands you already love, all in one place.",
  featuredCta: "See the deals",
  shop: (brand) => `Shop ${brand}`,
  codeLabel: "Code",
  endsOn: (ymd) => `Ends ${shortDay(ymd)}`,
  startsOn: (ymd) => `Starts ${shortDay(ymd)}`,
  none: "These deals have ended. Our gift guides are still full of ideas.",
  noneCta: "Browse the gift guides",
  loading: "Loading deals…",
};

/** The category sections, in page order (Louisiana shows only when it holds a deal). */
export const DEAL_CATEGORIES = ["Beauty", "Home & Kitchen", "Fashion", "Kids & Toys", "Tech", "Outdoors", "Louisiana"];
/** At most this many deals per section (owner brief 2026-11-19). */
export const DEALS_PER_SECTION = 25;

/** "2026-11-30" -> "Nov 30". */
export function shortDay(ymd) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The calendar day at `now` in Louisiana, "YYYY-MM-DD". */
export function louisianaDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Whether a deal shows on `today` (YYYY-MM-DD, Louisiana): never after its `ends` day (it shows through that day), and
 * an "announced" deal (the brand told us it is coming) only from its `starts` day.
 */
export function dealShows(deal, today) {
  if (deal.ends && deal.ends < today) return false;
  if (deal.status === "announced" && deal.starts && deal.starts > today) return false;
  return true;
}

/** The deals that show on `today`, in their order. */
export function liveDeals(deals, today) {
  return deals.filter((d) => dealShows(d, today));
}

/** The deals grouped into their sections, in DEAL_CATEGORIES order, each at most DEALS_PER_SECTION; empty ones left out. */
export function dealSections(deals) {
  return DEAL_CATEGORIES.map((category) => ({ category, deals: deals.filter((d) => d.category === category).slice(0, DEALS_PER_SECTION) })).filter((s) => s.deals.length > 0);
}

/** Whether the landing features the guide at its top on `today` (Nov 23 through Dec 1). */
export function dealsFeatured(today) {
  return today >= FEATURE_FROM && today <= FEATURE_TO;
}

/** The guide's title on `today`: "Black Friday & Cyber Monday Deals", then "Holiday Deals" after Dec 1. */
export function dealsTitle(today) {
  return today > RETITLE_AFTER ? DEALS_WORDS.laterTitle : DEALS_WORDS.title;
}
