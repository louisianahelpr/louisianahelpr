import top10 from "@/content/giftGuideTop10.json";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import type { EarnRanks } from "@/content/giftGuideEarnOrder";

/**
 * The gift guides landing's "Top 10 gifts" (owner 2026-11-21 ~5:05 PM: "put the top 10 items back when you open the
 * guide ... then once we have real clicks they can be replaced with the most clicked items"; she then named all ten).
 * The list is src/content/giftGuideTop10.json (its "_how" says how to swap one). Every spot shows its own item unless
 * the owner turned on `autoReplace` for it: such a spot goes, in order, to the most-clicked pick (at least
 * TOP10_MIN_CLICKS clicks in 14 days, src/content/giftGuideEarnRank.json) not already shown, and keeps its own item
 * until one qualifies. Guard: src/test/giftGuideTop10Landing1121.test.tsx.
 */
export interface Top10Slot { href: string; guide: string; name: string; autoReplace?: boolean }
export const TOP10_SLOTS: readonly Top10Slot[] = (top10 as { slots: Top10Slot[] }).slots;
const TOP10_SIZE = 10;
/** A pick needs this many clicks in the 14-day window to take an auto-replace spot. */
const TOP10_MIN_CLICKS = 20;
/** The guides the Top 10 draws from (their chunks hold every pick it can show). */
export const TOP10_GUIDES = ["her", "him", "kids"] as const;

export type Top10Pick = CatalogPick & { guide: string };

/**
 * The picks, in order. `pool` holds every pick of the three guides with its guide slug (one per link). A spot whose
 * link is no longer on any guide is skipped (never a made-up card), so the row can show fewer than ten until the JSON
 * is fixed; the guard checks every link resolves.
 */
export function top10Picks(pool: readonly Top10Pick[], slots: readonly Top10Slot[], clicks: EarnRanks, minClicks = TOP10_MIN_CLICKS): Top10Pick[] {
  const byHref = new Map(pool.map((p) => [p.href, p] as const));
  const kept = slots.slice(0, TOP10_SIZE);
  // An owner's fixed item is never shown twice, so a clicked pick never takes a spot to repeat one.
  const used = new Set(kept.filter((s) => !s.autoReplace && byHref.has(s.href)).map((s) => s.href));
  const hot = pool
    .filter((p) => (clicks[p.href] ?? 0) >= minClicks)
    .sort((a, b) => (clicks[b.href] ?? 0) - (clicks[a.href] ?? 0) || (a.href < b.href ? -1 : a.href > b.href ? 1 : 0));
  const out: Top10Pick[] = [];
  for (const s of kept) {
    const own = byHref.get(s.href);
    const clicked = s.autoReplace ? hot.find((p) => !used.has(p.href)) : undefined;
    const pick = clicked ?? (own && (!s.autoReplace || !used.has(own.href)) ? own : undefined);
    if (!pick) continue;
    used.add(pick.href);
    out.push(pick);
  }
  return out;
}
