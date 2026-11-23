import { discountCodes } from "@/content/giftGuides";
import { DEAL_CODES } from "@/content/giftGuidePicks";
import { cleanCodes } from "@/lib/giftGuideOfferCopy.mjs";
import { DEAL_EVENTS, codesDay, dealCode, dealsIn, liveDeals, louisianaDay, type Deal } from "@/content/giftGuideDeals.mjs";
import { louisianaMinutes, louisianaToday } from "@/content/holidayHub/holidayHub.mjs";
import RAIL from "@/content/giftGuideRailCounts.json";
import { codeCardCount, codesOn, salesOn } from "./GiftGuideDealCards";
import { loadModule, untilReload } from "@/lib/loadModule";

/**
 * The gift guides menu's numbers that change with the date (owner 2026-11-22: "Number on the right"), loaded in this
 * chunk after the menu draws (GiftGuidesSidebar.tsx), so a guide page's first paint carries none of it:
 *   each deals day: what its page lists right now, Top deals + Discount codes + Sales, by the page's own rules
 *     (GiftGuideDeals.tsx DealSections: only the cards still on, a code a card already shows is not a second card);
 *   the Holiday Hub: what /holidays lists with no filter at this minute (hubCountAt).
 * Small Business Saturday gets none: it also lists the live "Featured local" businesses from the database (see
 * scripts/gift-guide-rail-counts.mjs). A day with nothing listed gets no number. Guard: src/test/giftGuideRailCounts1122.test.tsx.
 */

/** The codes a deal card's code follows (GiftGuideDeals.tsx STORE_CODES, the same list). */
const STORE_CODES = [...discountCodes, ...cleanCodes(DEAL_CODES)];

/** A deals day's whole list on `today`: its live deal cards, its codes (minus those a card shows) and its store sales. */
export function dealDayCount(id: string, deals: Deal[], today: string): number {
  const day = DEAL_EVENTS.find((e) => e.id === id)!;
  const list = dealsIn(liveDeals(deals, today, STORE_CODES), id);
  const shown = new Set(list.flatMap((d) => dealCode(d, today, STORE_CODES) ?? []).map((c) => c.toUpperCase()));
  const on = codesDay(day, today);
  return list.length + codeCardCount(codesOn(on).filter((c) => !shown.has(c.code.toUpperCase()))) + salesOn(on).length;
}

/** What /holidays lists with no filter on `today` at `minutes` (Louisiana), from the schedule; null outside its window. */
export function hubCountAt(hub: typeof RAIL.hub, today: string, minutes: number): number | null {
  const day = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${hub.from}T12:00:00Z`)) / 864e5);
  if (day < 0 || day >= hub.days) return null;
  const at = day * 1440 + minutes;
  return hub.stay + hub.gone.filter((g) => g > at).length;
}

/** Every date-bound menu number at `now`, by menu key (a deals day's id, "/holidays"); a row with none is left out. */
export async function railCounts(now: Date = new Date()): Promise<Record<string, number>> {
  // Through loadModule (noPropertyOffARawImport): null only while a recovery reload is on its way, so wait for it.
  const mod = await loadModule(() => import("@/content/giftGuideDeals.json"));
  if (!mod) return untilReload();
  const deals = mod.default as Deal[];
  const today = louisianaDay(now);
  const out: Record<string, number> = {};
  for (const e of DEAL_EVENTS) if (e.kind === "deals") out[e.id] = dealDayCount(e.id, deals, today);
  const hub = hubCountAt(RAIL.hub, louisianaToday(now), louisianaMinutes(now));
  if (hub !== null) out["/holidays"] = hub;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
