import { activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { cleanCodes, cleanSales } from "@/lib/giftGuideOfferCopy.mjs";
import { DEAL_EVENTS } from "@/content/giftGuideDeals.mjs";

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

/** The codes that work on `day` (YYYY-MM-DD), by store rank, one entry per code. */
export const codesOn = (day: string): DiscountCode[] => codesByStore(activeCodes([...discountCodes, ...CLEAN_CODES], day)).flatMap((s) => s.codes);

/** The store sales on `day`, one entry per store (its sales soonest end first), the stores in first-sale order. */
export const salesOn = (day: string) => {
  const stores = new Map<string, Sale[]>();
  // Guides audit 1122 #15: a line that names the OTHER deal day (Cyber Monday's "Black Friday Deals Are in") is left off;
  // a line that names both days ("Black Friday/Cyber Monday") stays.
  const here = DEAL_EVENTS.find((e) => e.kind === "deals" && e.day === day);
  const other = here && DEAL_EVENTS.filter((e) => e.kind === "deals" && e !== here).map((e) => e.title);
  const namesOther = (offer: string) => Boolean(here && other!.some((t) => offer.includes(t)) && !offer.includes(here.title));
  for (const x of liveSales(CLEAN_SALES.filter((s) => !namesOther(s.offer)), day)) stores.set(x.store, [...(stores.get(x.store) ?? []), x]);
  return [...stores.entries()].map(([store, sales]) => ({ store, sales }));
};

/** How many cards the codes make: one per store with a link. */
export const codeCardCount = (codes: readonly DiscountCode[]) => new Set(codes.filter((c) => c.href).map((c) => c.store)).size;
