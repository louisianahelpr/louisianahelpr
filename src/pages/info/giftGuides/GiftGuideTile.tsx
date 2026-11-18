import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { childrenOf, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideCover } from "./GiftGuideCover";

/** What a guide holds, in a few words: its guides (a hub), its picks, "On ShopMy" (a collection-only guide), or "Coming soon". */
export const countOf = (g: CatalogGuide) =>
  g.children ? G.guidesCount(childrenOf(g).length) : g.picks.length > 0 ? G.picksCount(g.picks.length) : g.links.length > 0 ? G.onShopMy : G.comingSoon;

/** A tile's caption: the age band first when the guide has one ("ages 0–1 · 25 picks", owner 2026-11-18). */
const captionOf = (g: CatalogGuide) => [g.age, countOf(g)].filter(Boolean).join(" · ");

/** A guide's tile: its square cover, its name, and what it holds. Opens /gift-guides/<slug>. */
export function GiftGuideTile({ g }: { g: CatalogGuide }) {
  return (
    <li>
      <Link to={`/gift-guides/${g.slug}`} className="gg-tile" data-gift-tile={g.slug}>
        <GiftGuideCover guide={g} />
        <span className="gg-name">{g.title}</span>
        <span className="gg-count">{captionOf(g)}</span>
      </Link>
    </li>
  );
}
