import { DEAL_EVENTS, louisianaDay, type Deal } from "@/content/giftGuideDeals.mjs";
import { louisianaMinutes, louisianaToday } from "@/content/holidayHub/holidayHub.mjs";
import RAIL from "@/content/giftGuideRailCounts.json";
import { featuredLocalCount } from "@/lib/sbsFeaturedCount";
import { dealDayParts } from "@/content/giftGuideDealCounts";
import { loadModule, untilReload } from "@/lib/loadModule";

/**
 * Small Business Saturday's whole list (owner 2026-11-22, 8:36 PM: "add the count to small business saturday too"): the
 * 25 Days sponsor businesses (RAIL.smallBiz, giftGuideSmallBiz.json's rows) plus the approved "Featured local" businesses
 * the page lists under them. The page reads those with listFeaturedLocal (counted by featuredLocalCount) and passes no sponsors to filter them by
 * (GiftGuideDeals.tsx `<Local sponsors={[]} />`), so it shows every one: the same read here (the public,
 * approved-only list from sbs_public_featured, a STABLE read-only function; nothing is written), once per page load. A failed read gives the sponsors alone, never a guess.
 */
export async function smallBizCount(): Promise<number> {
  try {
    return RAIL.smallBiz + (await featuredLocalCount());
  } catch (e) {
    // The menu keeps the sponsors' count; the page reports its own failed read.
    console.warn("gift guides: menu featured-local count failed", e);
    return RAIL.smallBiz;
  }
}

/**
 * The gift guides menu's numbers that change with the date (owner 2026-11-22: "Number on the right"), loaded in this
 * chunk after the menu draws (GiftGuidesSidebar.tsx), so a guide page's first paint carries none of it:
 *   each deals day: what its page lists right now, Top deals + Discount codes + Sales, by the page's own rules
 *     (GiftGuideDeals.tsx DealSections: only the cards still on, a code a card already shows is not a second card);
 *   the Holiday Hub: what /holidays lists with no filter at this minute (hubCountAt);
 *   Small Business Saturday (smallBizCount): its sponsor businesses plus the approved "Featured local" ones it lists.
 * A day with nothing listed gets no number. Guard: src/test/giftGuideRailCounts1122.test.tsx.
 */

/** A deals day's whole list on `today`: its live deal cards, its codes (minus those a card shows) and its store sales. */
export function dealDayCount(id: string, deals: Deal[], today: string): number {
  const p = dealDayParts(id, deals, today);
  return p.deals + p.steals + p.codes + p.sales;
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
