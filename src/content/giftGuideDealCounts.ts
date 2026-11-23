import { activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { cleanCodes, cleanSales } from "@/lib/giftGuideOfferCopy.mjs";
import { DEAL_EVENTS, codesDay, dealCode, dealsIn, liveDeals, louisianaDay, type Deal } from "@/content/giftGuideDeals.mjs";

/**
 * The deals days' codes and sales rules, with no React and no card code: the deals pages draw their cards from them
 * (GiftGuideDealCards.tsx re-exports them) and the gift guides menu counts with them (railCounts.ts), so the menu's lazy
 * chunk never downloads the cards, the heart or the wish list (lead 11-22: those put ~14 KB gz after the menu drew on
 * every guide page). Guard: src/test/giftGuideRailCounts1122.test.tsx (railCounts reaches no .tsx).
 */

const CLEAN_CODES = cleanCodes(DEAL_CODES);
const CLEAN_SALES = cleanSales(SALES);

/** The sales still on `today` (YYYY-MM-DD): a sale shows through its end day, one line per link. */
export const liveSales = (sales: readonly Sale[], today: string) => {
  // One line per link (design audit r2 #10: 9 duplicate hrefs, Gilt and Gilt City repeating the same offers).
  const seen = new Set<string>();
  return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href)));
};

/**
 * Whether an offer line names the OTHER deal day and not `day`'s own (Cyber Monday's "Black Friday Deals Are in"); a
 * line that names both days ("Black Friday/Cyber Monday") names its own too. Guides audit 1122 #15 (sales) and 1123 #11
 * (codes: Bonheur's "35% off (Black Friday)" sat on the Cyber Monday page).
 */
const namesOtherDay = (day: string) => {
  const here = DEAL_EVENTS.find((e) => e.kind === "deals" && e.day === day);
  const other = here ? DEAL_EVENTS.filter((e) => e.kind === "deals" && e !== here).map((e) => e.title) : [];
  return (offer: string) => Boolean(here && other.some((t) => offer.includes(t)) && !offer.includes(here.title));
};

/**
 * The codes that work on `day` (YYYY-MM-DD), by store rank, one entry per code. A code the brand embargoed (its
 * `embargo`, e.g. Bonheur's BLKFRIDAY35 until Nov 26) stays off every page until its `starts` day comes on `today`,
 * even when the deal day it works on is later (guide audit 1123 #5: it showed on Nov 23 with "Starts Nov 26").
 */
export const codesOn = (day: string, today: string = louisianaDay(new Date())): DiscountCode[] => {
  const namesOther = namesOtherDay(day);
  const shown = activeCodes([...discountCodes, ...CLEAN_CODES], day)
    .filter((c) => !(c.embargo && c.starts && today < c.starts))
    .filter((c) => !namesOther(c.offer));
  return codesByStore(shown).flatMap((s) => s.codes);
};

/** The store sales on `day`, one entry per store (its sales soonest end first), the stores in first-sale order. */
export const salesOn = (day: string) => {
  const stores = new Map<string, Sale[]>();
  // Guides audit 1122 #15: a line that names the OTHER deal day (Cyber Monday's "Black Friday Deals Are in") is left off;
  // a line that names both days ("Black Friday/Cyber Monday") stays.
  const namesOther = namesOtherDay(day);
  for (const x of liveSales(CLEAN_SALES.filter((s) => !namesOther(s.offer)), day)) stores.set(x.store, [...(stores.get(x.store) ?? []), x]);
  return [...stores.entries()].map(([store, sales]) => ({ store, sales }));
};

/** The bigger the percent in a code's offer, the better it is; an offer with none ranks after one with a percent. */
const codePercent = (c: DiscountCode) => Number(/(\d+)\s*%/.exec(c.offer)?.[1] ?? 0);

/** The code a store's card leads with (GiftGuideDealCards.tsx CodeCard; the pre-JS list leads with the same one). */
export const bestCode = (codes: readonly DiscountCode[]): DiscountCode => codes.reduce((a, c) => (codePercent(c) > codePercent(a) ? c : a), codes[0]);

/**
 * The codes with a link, one group per store in first-appearance order, each store's best code first and its others in
 * order: the cards CodeCards draws, flattened (seo bodies 1123 lists them in this order).
 */
export function codeCardsOrder(codes: readonly DiscountCode[]): DiscountCode[] {
  const byStore = new Map<string, DiscountCode[]>();
  for (const c of codes) if (c.href) byStore.set(c.store, [...(byStore.get(c.store) ?? []), c]);
  return [...byStore.values()].flatMap((list) => {
    const best = bestCode(list);
    return [best, ...list.filter((c) => c !== best)];
  });
}

/** How many cards the codes make: one per store with a link. */
export const codeCardCount = (codes: readonly DiscountCode[]) => new Set(codes.filter((c) => c.href).map((c) => c.store)).size;

/** The codes a deal card's code follows (GiftGuideDeals.tsx STORE_CODES, the same list). */
export const STORE_CODES = [...discountCodes, ...CLEAN_CODES];

/**
 * Live data (owner 2026-11-23: the app's guides pull the latest deals and codes from the site with no release): the
 * deals page hands a newer valid copy of src/content/giftGuideCodes.json here (GiftGuideDeals.tsx), and every list that
 * reads the codes (discountCodes, STORE_CODES, codesOn) reads its rows from then on. In place, so each reader keeps
 * its one list. Guard: src/test/liveGuideData1123.test.ts.
 */
export function setStoreCodes(codes: readonly DiscountCode[]) {
  discountCodes.splice(0, discountCodes.length, ...codes);
  STORE_CODES.splice(0, STORE_CODES.length, ...codes, ...CLEAN_CODES);
}

/**
 * What a deals day's page lists on `today`, by its three sections (GiftGuideDeals.tsx DealSections): the Top deals cards
 * still on, the Discount codes cards (one per store, minus a code a Top deal card already shows) and the store Sales.
 * The gift guides menu's number is their sum (railCounts.ts dealDayCount) and the page's "Common questions" names the
 * same three (guideQa.mjs dealsDayQa, also in the pre-JS body through seo-data's dealParts), so the menu, the section
 * heads and the Q&A cannot disagree (guide train p 11-23: the Q&A said "19 deals" beside the menu's 61).
 */
export function dealDayParts(id: string, deals: readonly Deal[], today: string): { deals: number; codes: number; sales: number } {
  const l = dealDayLists(id, deals, today);
  return { deals: l.deals.length, codes: codeCardCount(l.codes), sales: l.sales.length };
}

/**
 * The three sections' own rows on `today` (the counts above are their sizes): the Top deals cards, the codes the
 * Discount codes cards draw (GiftGuideDeals.tsx DealSections: minus a code a Top deal card already shows) and the store
 * Sales. The pre-JS body lists the same rows (seo bodies 1123, src/prerender/seoData.ts dealListsTable), so a reader with
 * no JavaScript sees what the page shows.
 */
export function dealDayLists(id: string, deals: readonly Deal[], today: string): { deals: Deal[]; codes: DiscountCode[]; sales: { store: string; sales: Sale[] }[] } {
  const day = DEAL_EVENTS.find((e) => e.id === id)!;
  const list = dealsIn(liveDeals(deals, today, STORE_CODES), id);
  const shown = new Set(list.flatMap((d) => dealCode(d, today, STORE_CODES) ?? []).map((c) => c.toUpperCase()));
  const on = codesDay(day, today);
  return { deals: list, codes: codesOn(on, today).filter((c) => !shown.has(c.code.toUpperCase())), sales: salesOn(on) };
}
