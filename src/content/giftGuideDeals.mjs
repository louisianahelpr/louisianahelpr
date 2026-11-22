/**
 * The deals days (owner 2026-11-19: "You can build the rest of the Black Friday and Cyber Monday guides asap"; owner
 * 2026-11-21: "we still need to do the black friday section, small business saturday, and cyber monday deals", and
 * "Codes and deals shouldn't randomly show in sections": deals never show inside Her, Him or Kids). Owner 2026-11-21
 * later: "remove small business stuff from black friday stuff. like each day has its own section, no need to put them
 * all in 1": each day is its OWN page, /gift-guides/<DEAL_EVENTS id>: /gift-guides/black-friday (Fri Nov 27),
 * /gift-guides/small-business-saturday (Sat Nov 28, the confirmed Louisiana 25 Days sponsors) and
 * /gift-guides/cyber-monday (Mon Nov 30), each with only its own cards and codes. The old one-page address
 * /gift-guides/black-friday-cyber-monday (DEALS_SLUG) opens Black Friday, and its old #<day> anchors open that day's
 * page (oldDealsTarget). Its words, its dates
 * and the rules that hide a deal live here, in plain JS, so the page (GiftGuideDeals.tsx), the pre-JS head
 * (giftGuidePageMeta.mjs, api/share.ts) and the generator (scripts/gift-guide-deals.mjs) all read one copy.
 * The deals themselves are src/content/giftGuideDeals.json (generated; loaded only when the page opens).
 * Every date is the calendar day in Louisiana (America/Chicago), whatever the visitor's own zone.
 * Guard: src/test/giftGuideDeals1119.test.tsx. Types: giftGuideDeals.d.mts.
 */

/**
 * The old one-page address (now a redirect, oldDealsTarget) and the wish list's key for a hearted deal card (saved
 * lists already hold it, so it never changes).
 */
export const DEALS_SLUG = "black-friday-cyber-monday";

/** The landing features the guide at its top from this day through FEATURE_TO (owner brief 2026-11-19). */
export const FEATURE_FROM = "2026-11-23";
export const FEATURE_TO = "2026-12-01";
/** After this day the guide is "Holiday Deals" (Cyber Monday is Nov 30; the brief keeps the name through Dec 1). */
export const RETITLE_AFTER = "2026-12-01";

/**
 * The three day pages, in calendar order; `id` is the page's slug. `kind`: "deals" (cards from giftGuideDeals.json
 * with this event) or "small-biz" (the 25 Days sponsors from giftGuideSmallBiz.json). `pageTitle` is the banner's
 * title, `lead` the line above it and `description` its search result line (owner 11-21: no intro on the page). Each says
 * its day before it, on it and after it.
 */
export const DEAL_EVENTS = [
  {
    id: "black-friday", kind: "deals", day: "2026-11-27", title: "Black Friday",
    pageTitle: "Black Friday Deals", lead: "the best",
    description: "Black Friday Deals 2026: Black Friday sales and codes from brands you already love, picked by Louisiana Helpr.",
    before: "Fri, Nov 27. Plenty of these sales are on already.",
    on: "Today, Fri, Nov 27. These sales are on now.",
    after: "Black Friday was Nov 27. Some of these sales run a little longer.",
  },
  {
    id: "small-business-saturday", kind: "small-biz", day: "2026-11-28", title: "Small Business Saturday",
    pageTitle: "Small Business Saturday", lead: "shop small",
    description: "Small Business Saturday 2026: Louisiana shops, makers and local favorites sponsoring Louisiana Helpr's 25 Days of Giveaways, with a link to each one.",
    before: "Sat, Nov 28. Shop Louisiana: these local businesses are all sponsors of our 25 Days of Giveaways.",
    on: "Today, Sat, Nov 28. Shop Louisiana: these local businesses are all sponsors of our 25 Days of Giveaways.",
    after: "Small Business Saturday was Nov 28. These Louisiana businesses, all 25 Days sponsors, are open all season.",
  },
  {
    id: "cyber-monday", kind: "deals", day: "2026-11-30", title: "Cyber Monday",
    pageTitle: "Cyber Monday Deals", lead: "the best",
    description: "Cyber Monday Deals 2026: Cyber Monday and Cyber Week sales and codes from brands you already love, picked by Louisiana Helpr.",
    before: "Mon, Nov 30. Cyber Week sales, and deals that run through Cyber Monday.",
    on: "Today, Mon, Nov 30. Last call on Cyber Week sales.",
    after: "Cyber Monday was Nov 30. Some of these sales run a little longer.",
  },
];

/** The day pages' slugs, in calendar order. */
export const DEAL_DAY_SLUGS = DEAL_EVENTS.map((e) => e.id);

/** The day page a slug names, or null. */
export function dealDay(slug) {
  return DEAL_EVENTS.find((e) => e.id === slug) ?? null;
}

/**
 * Where the old one-page address goes (owner 11-21: each day its own page): its #<day> anchor's page, else Black
 * Friday. `hash` is "" or "#small-business-saturday".
 */
export function oldDealsTarget(hash) {
  return dealDay(String(hash ?? "").replace(/^#/, ""))?.id ?? DEAL_EVENTS[0].id;
}

/**
 * The day a day page's codes and sales must still work on: the day itself, or today once it has passed (a code that
 * ended after the day is gone). A code with no dates works every day, so it shows on both deals days.
 */
export function codesDay(event, today) {
  return today > event.day ? today : event.day;
}

/** At most this many deals from one brand on the whole page (owner 11-20: about 2 of a brand at most). */
export const DEALS_PER_BRAND = 2;

export const DEALS_WORDS = {
  title: "Black Friday & Cyber Monday Deals",
  laterTitle: "Holiday Deals",
  // Owner 2026-11-21 ("remove this"): no intro paragraph, "#ad" line or helper line on the deals page. The page keeps
  // the gift guides' standard affiliate disclosure in its footer (GiftGuides.tsx); the pre-JS body (api/share.ts)
  // carries the same words.
  disclosure: "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.",
  // Holiday audit 1121 #80: "hand-checked" overclaimed (the rows come from affiliate feeds; dates can change).
  featuredLine: "Sales from brands you already love, all in one place.",
  featuredCta: "See the deals",
  shop: (brand) => `Shop ${brand}`,
  shopShort: "Shop",
  codeLabel: "Code",
  endsOn: (ymd) => `Ends ${shortDay(ymd)}`,
  startsOn: (ymd) => `Starts ${shortDay(ymd)}`,
  shopSmall: "More Louisiana small businesses on Shop Small",
  none: "These deals have ended. Our gift guides are still full of ideas.",
  noneCta: "Browse the gift guides",
  loading: "Loading deals…",
};

/** "2026-11-30" -> "Nov 30". */
export function shortDay(ymd) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The calendar day at `now` in Louisiana, "YYYY-MM-DD". */
export function louisianaDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "XTRATUF", "Xtratuf " -> "xtratuf": a store or brand name, compared loosely. */
const storeKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The day a deal ends (YYYY-MM-DD), or undefined when nobody published one: its own `ends`, else the expiry of the
 * store code it carries (the same code, for the same store, in the discount codes list: XTRATUF's XT25 sale is the
 * code, and the code ends Nov 29). Holiday audit 1121 (High): the codes box hid XT25 on Nov 30 while its card kept it.
 */
export function dealEnds(deal, codes = []) {
  if (deal.ends) return deal.ends;
  if (!deal.code) return undefined;
  return codes.find((c) => c.code === deal.code && c.expires && storeKey(c.store) === storeKey(deal.brand))?.expires;
}

/** The code a deal card offers on `today`, or undefined once that store code has expired (even if the sale runs on). */
export function dealCode(deal, today, codes = []) {
  if (!deal.code) return undefined;
  const expires = dealEnds({ brand: deal.brand, code: deal.code }, codes);
  return expires && expires < today ? undefined : deal.code;
}

/**
 * Whether a deal shows on `today` (YYYY-MM-DD, Louisiana): through its end day (dealEnds), never after. A deal with no
 * known end shows only through RETITLE_AFTER (Dec 1, the day after Cyber Monday): holiday audit 1121 (High) found 20
 * of 28 cards had no end and stayed up for good, under "These sales are still on". No end day is ever made up for a
 * card; the card simply goes. An "announced" deal (the brand told us it is coming) shows before its `starts` day too,
 * with "Starts <day>" on its card (dealStartsLater), so a section reads sensibly before its date.
 */
export function dealShows(deal, today, codes = []) {
  const ends = dealEnds(deal, codes);
  return ends ? ends >= today : today <= RETITLE_AFTER;
}

/** Whether a deal's card says "Starts <day>": an announced deal whose start day is still ahead. */
export function dealStartsLater(deal, today) {
  return deal.status === "announced" && !!deal.starts && deal.starts > today;
}

/** The deals that show on `today`, in their order. */
export function liveDeals(deals, today, codes = []) {
  return deals.filter((d) => dealShows(d, today, codes));
}

/** Where `today` falls against a section's day: "before", "on" or "after". */
export function eventPhase(event, today) {
  return today < event.day ? "before" : today === event.day ? "on" : "after";
}

/**
 * The sections in page order on `today`: the ones whose day is still ahead (or today) in calendar order, then the ones
 * whose day has passed, so the next big day is always at the top and a past one stays below while its sales run.
 */
export function eventOrder(today) {
  const open = DEAL_EVENTS.filter((e) => eventPhase(e, today) !== "after");
  const past = DEAL_EVENTS.filter((e) => eventPhase(e, today) === "after");
  return [...open, ...past];
}

/** The deals of one section, in their order. */
export function dealsIn(deals, eventId) {
  return deals.filter((d) => d.event === eventId);
}

/** Whether the landing features the guide at its top on `today` (Nov 23 through Dec 1). */
export function dealsFeatured(today) {
  return today >= FEATURE_FROM && today <= FEATURE_TO;
}

/** The guide's title on `today`: "Black Friday & Cyber Monday Deals", then "Holiday Deals" after Dec 1. */
export function dealsTitle(today) {
  return today > RETITLE_AFTER ? DEALS_WORDS.laterTitle : DEALS_WORDS.title;
}

/**
 * A deal's name in a list: the item when it already starts with the brand, else "Brand: item"
 * (UX audit L2: "ELEMIS: ELEMIS Pro-Collagen..."), else the brand and the sale. Here with the deals data (train 1121i),
 * so the deals page and the wish list share it without pulling the wish list's item reader onto the guide pages.
 * @param {{ brand: string, item?: string | null, deal: string }} d
 */
export const dealName = (d) => {
  if (!d.item) return `${d.brand}: ${d.deal}`;
  return d.item.toLowerCase().startsWith(d.brand.toLowerCase()) ? d.item : `${d.brand}: ${d.item}`;
};
