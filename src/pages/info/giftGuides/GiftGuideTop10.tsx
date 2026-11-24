import { useEffect, useSyncExternalStore } from "react";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import { EARN_CLICKS } from "@/content/giftGuideEarnOrder";
import { TOP10_GUIDES, TOP10_SLOTS, top10Picks, type Top10Pick } from "@/content/giftGuideTop10";
import { PricesAsOf } from "@/components/giftGuides/PickPrice";
import { PickRow } from "./GiftGuideView";

/**
 * "Top 10 gifts" on the gift guides landing (owner 2026-11-21 ~5:05 PM; the list and its rule: src/content/giftGuideTop10.ts).
 * The same card as the guides (photo and name are one link, the price, the heart), a calm sideways row on a phone and
 * a grid of five on a wider screen, under the three guide tiles. It loads the Her, Him and Kids picks after the page
 * opens and draws once they are in, so nothing above it moves. Owner 11-21 evening ("number the top 10 gifts"): each card
 * wears its rank, a small serif numeral on the photo's top-left corner, and says it first ("1. Therabody Theragun Mini").
 * Guard: src/test/giftGuideTop10Landing1121.test.tsx.
 */
export function GiftGuideTop10() {
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    for (const slug of TOP10_GUIDES) loadGuidePicks(slug).catch((e: unknown) => console.warn("gift guides Top 10: picks chunk failed", slug, e));
  }, []);
  if (!TOP10_GUIDES.every((s) => picksReady(s))) return null;
  const seen = new Set<string>();
  const pool: Top10Pick[] = TOP10_GUIDES.flatMap((slug) =>
    (guideBySlug(slug)?.picks ?? []).flatMap((p) => (seen.has(p.href) ? [] : (seen.add(p.href), [{ ...p, guide: slug }]))),
  );
  const top = top10Picks(pool, TOP10_SLOTS, EARN_CLICKS);
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="gift-top10" className="gg-top10-wrap" data-gift-top10="">
      <h2 id="gift-top10" className="gg-top10-h">{G.top10Title}</h2>
      <ul className="gg-list gg-top10">
        {top.map((p, i) => <PickRow key={p.href} pick={p} guide={p.guide} rank={i + 1} similar={false} />)}
      </ul>
      <PricesAsOf picks={top} />
    </section>
  );
}
