/**
 * The deals page, /gift-guides/black-friday-cyber-monday (owner 2026-11-19: "You can build the rest of the Black Friday
 * and Cyber Monday guides asap"; owner 2026-11-21: "we still need to do the black friday section, small business
 * saturday, and cyber monday deals", and "Codes and deals shouldn't randomly show in sections": deals live on this one
 * page, never inside Her, Him or Kids). Three sections in calendar order: Black Friday (Fri Nov 27), Small Business
 * Saturday (Sat Nov 28, the confirmed Louisiana 25 Days sponsors) and Cyber Monday (Mon Nov 30). Its words, its dates
 * and the rules that hide a deal live here, in plain JS, so the page (GiftGuideDeals.tsx), the pre-JS head
 * (giftGuidePageMeta.mjs, api/share.ts) and the generator (scripts/gift-guide-deals.mjs) all read one copy.
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

/**
 * The page's three sections, in calendar order. `kind`: "deals" (cards from giftGuideDeals.json with this event) or
 * "small-biz" (the 25 Days sponsors from giftGuideSmallBiz.json). Each says its day before it, on it and after it.
 */
export const DEAL_EVENTS = [
  {
    id: "black-friday", kind: "deals", day: "2026-11-27", title: "Black Friday",
    before: "Fri, Nov 27. Plenty of these sales are on already.",
    on: "Today, Fri, Nov 27. These sales are on now.",
    after: "Black Friday was Nov 27. These sales are still on.",
  },
  {
    id: "small-business-saturday", kind: "small-biz", day: "2026-11-28", title: "Small Business Saturday",
    before: "Sat, Nov 28. Shop Louisiana: these local businesses are all sponsors of our 25 Days of Giveaways.",
    on: "Today, Sat, Nov 28. Shop Louisiana: these local businesses are all sponsors of our 25 Days of Giveaways.",
    after: "Small Business Saturday was Nov 28. These Louisiana businesses, all 25 Days sponsors, are open all season.",
  },
  {
    id: "cyber-monday", kind: "deals", day: "2026-11-30", title: "Cyber Monday",
    before: "Mon, Nov 30. Cyber Week sales, and deals that run through Cyber Monday.",
    on: "Today, Mon, Nov 30. Last call on Cyber Week sales.",
    after: "Cyber Monday was Nov 30. These sales are still on.",
  },
];

/** At most this many deals from one brand on the whole page (owner 11-20: about 2 of a brand at most). */
export const DEALS_PER_BRAND = 2;

export const DEALS_WORDS = {
  title: "Black Friday & Cyber Monday Deals",
  laterTitle: "Holiday Deals",
  lead: "the best",
  // Owner 2026-11-21 ("remove this"): no intro paragraph, "#ad" line or helper line on the deals page. The page keeps
  // the gift guides' standard affiliate disclosure in its footer (GiftGuides.tsx); the pre-JS body (api/share.ts)
  // carries the same words.
  disclosure: "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.",
  featuredLine: "Hand-checked sales from brands you already love, all in one place.",
  featuredCta: "See the deals",
  shop: (brand) => `Shop ${brand}`,
  codeLabel: "Code",
  endsOn: (ymd) => `Ends ${shortDay(ymd)}`,
  startsOn: (ymd) => `Starts ${shortDay(ymd)}`,
  jumpLabel: "Jump to a day",
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

/**
 * Whether a deal shows on `today` (YYYY-MM-DD, Louisiana): through its `ends` day, never after. An "announced" deal
 * (the brand told us it is coming) shows before its `starts` day too, with "Starts <day>" on its card (dealStartsLater),
 * so a section reads sensibly before its date.
 */
export function dealShows(deal, today) {
  return !(deal.ends && deal.ends < today);
}

/** Whether a deal's card says "Starts <day>": an announced deal whose start day is still ahead. */
export function dealStartsLater(deal, today) {
  return deal.status === "announced" && !!deal.starts && deal.starts > today;
}

/** The deals that show on `today`, in their order. */
export function liveDeals(deals, today) {
  return deals.filter((d) => dealShows(d, today));
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
