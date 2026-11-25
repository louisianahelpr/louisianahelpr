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
/**
 * Guide prerender round 3 (11-24): while the three picks chunks load, the section keeps its place with the same card
 * boxes, unpainted (visibility hidden). It used to draw nothing, so the 25 Days card below it was drawn in the first
 * screen (y 468 at 375) and then pushed down when the cards arrived: CLS 0.149 after the hand-off, and on a slow phone
 * that card, drawn under the HTML first screen, was the landing's largest paint (4.7 s). Same classes as PickRow and
 * PricesAsOf (PickThumb's photo box holding a blank image, one badge line: a sideways phone row is as tall as its tallest card),
 * so the height is the drawn section's (measured equal at 375; a desktop row with no badge is up to 25px shorter, and
 * the card below moves up off screen). Guard: src/test/guideShells.test.ts.
 */
/** A 1x1 transparent GIF: PickThumb's <img> box (width 100%, square) with nothing to fetch. */
const BLANK_PHOTO = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function Top10Wait() {
  return (
    <section className="gg-top10-wrap" aria-hidden="true" data-gift-top10-wait="" style={{ visibility: "hidden" }}>
      <p className="gg-top10-h">{G.top10Title}</p>
      <ul className="gg-list gg-top10">
        {Array.from({ length: TOP10_SLOTS.length }, (_, i) => (
          <li key={i}>
            {/* A real card is as wide as its name; an empty one would shrink to its 44px minimum without the stretch. */}
            <span className="gg-item" style={{ alignSelf: "stretch" }}>
              <span className="gg-photo"><img className="gg-thumb" src={BLANK_PHOTO} alt="" width={52} height={52} /></span>
              <span className="gg-nm">
                <span className="gg-nm-name">{"\u00a0"}</span>
                <small className="gg-nm-meta"><span className="gg-price">{"\u00a0"}</span></small>
                <span className="gg-badges"><i className="gg-bdg">{"\u00a0"}</i></span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="gg-price-note">{"\u00a0"}</p>
    </section>
  );
}

export function GiftGuideTop10() {
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    for (const slug of TOP10_GUIDES) loadGuidePicks(slug).catch((e: unknown) => console.warn("gift guides Top 10: picks chunk failed", slug, e));
  }, []);
  if (!TOP10_GUIDES.every((s) => picksReady(s))) return <Top10Wait />;
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
