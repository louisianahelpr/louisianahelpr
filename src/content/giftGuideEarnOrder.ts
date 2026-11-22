import earnRank from "@/content/giftGuideEarnRank.json";
import type { PriceOrder } from "@/content/giftGuidePriceSort";
import { designTogether } from "@/lib/giftGuideDesign.mjs";

/**
 * "Reorder by what earns" (lead 11-21, owner pop-up: all of the growth items): on Her, Him, Kids and their views, the
 * default order ("Recommended") puts the picks people click most at the top of their OWN price section; the rest keep
 * the section's low-to-high order below them. The explicit "Price: low to high / high to low" choices stay pure price.
 *
 * The ranks are src/content/giftGuideEarnRank.json, written by scripts/gift-guide-earn-rank.mjs from our own outbound
 * click log (analytics_events_real, event gift_out_click, last 14 days; GiftOut.tsx sends it). Keyed by the pick's
 * shop link (href), so a relationship view shares Her's or Him's ranks. An empty map changes nothing.
 * Owner 2026-11-22 ("put the ducks designs together ..."): a clicked item never splits a same-brand, same-design pair at
 * one price; its partners come up right after it (src/lib/giftGuideDesign.mjs).
 * Guard: src/test/giftGuideEarnOrder1121.test.tsx, src/test/giftGuideSameDesignTogether1122.test.ts.
 */
export type EarnRanks = Readonly<Record<string, number>>;

/** An owner-list guide's order: "top" (Recommended, the default) or an explicit price order. */
export type GuideOrder = "top" | PriceOrder;

export const EARN_RANKS: EarnRanks = (earnRank as { ranks: Record<string, number> }).ranks;
/** Each link's raw clicks over the same 14 days (the landing Top 10's rule, src/content/giftGuideTop10.ts). */
export const EARN_CLICKS: EarnRanks = (earnRank as { clicks?: Record<string, number> }).clicks ?? {};

const ranked = (r: number | undefined): r is number => typeof r === "number" && Number.isFinite(r) && r > 0;

/**
 * Within each run of picks sharing a group (a price section: groups arrive contiguous), the ranked picks first by rank
 * (1 = most clicks), then the unranked ones in their incoming order; then each same-brand, same-price, same-design
 * partner is pulled right after the highest placed of its group (owner 2026-11-22). Group order and membership never
 * change. Never mutates its input.
 */
export function earnFirstInGroups<T extends { href: string; name?: string; brand?: string; price?: number }>(picks: readonly T[], ranks: EarnRanks, groupOf: (p: T) => string): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < picks.length) {
    const g = groupOf(picks[i]);
    let j = i;
    while (j < picks.length && groupOf(picks[j]) === g) j += 1;
    const run = picks.slice(i, j);
    const hot = run.filter((p) => ranked(ranks[p.href])).sort((a, b) => ranks[a.href] - ranks[b.href]);
    out.push(...designTogether([...hot, ...run.filter((p) => !ranked(ranks[p.href]))], (p) => p));
    i = j;
  }
  return out;
}
