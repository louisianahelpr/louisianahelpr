import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { GUIDES, guideBySlug, guidePicksVersion, loadGuidePicks, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import { GiftGuideTile } from "./GiftGuideTile";
import { PickRow } from "./GiftGuideView";
import { PricesAsOf } from "@/components/giftGuides/PickPrice";
import { useGiftList } from "./giftList";

/**
 * /gift-guides?list=mine (owner 2026-11-18): the guides and picks this visitor hearted, from this browser's My list.
 * A saved item the guides no longer carry is left out (never a dead tile or link). A pick saved from a guide whose
 * picks are a lazy chunk shows once that chunk is in (only those guides' chunks are fetched).
 */
export function GiftGuideMyList() {
  const list = useGiftList();
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const from = [...new Set(list.picks.map((p) => p.guide).filter((s): s is string => Boolean(s && guideBySlug(s))))].join(" ");
  useEffect(() => {
    for (const s of from.split(" ").filter(Boolean)) {
      loadGuidePicks(s).catch((e: unknown) => {
        // A failed chunk only leaves that guide's saved picks off the list this visit.
        console.warn("gift guides: picks chunk failed", s, e);
      });
    }
  }, [from]);
  const guides = list.guides.map((s) => guideBySlug(s)).filter((g) => g !== undefined);
  const all = GUIDES.flatMap((g) => g.picks);
  const picks = list.picks.map((s) => all.find((p) => p.href === s.href && p.name === s.name)).filter((p) => p !== undefined);
  return (
    <section aria-labelledby="gift-my-list" data-gift-my-list="">
      <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>
      <div className="gg-rowhead"><h2 id="gift-my-list">{G.myListLabel}</h2></div>
      {guides.length === 0 && picks.length === 0 && <p className="gg-soon" data-gift-my-list-empty="">{G.myListEmpty}</p>}
      {guides.length > 0 && <ul className="gg-wrap">{guides.map((g) => <GiftGuideTile key={g.slug} g={g} />)}</ul>}
      {picks.length > 0 && <ol className="gg-list" data-gift-list="">{picks.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}</ol>}
      <PricesAsOf picks={picks} />
    </section>
  );
}
