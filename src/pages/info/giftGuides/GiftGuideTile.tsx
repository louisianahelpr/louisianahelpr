import { Link } from "react-router-dom";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideCover } from "./GiftGuideCover";
import { Heart, toggleGuide, useGiftList } from "./giftList";

/** A guide's tile: its square cover and its name (owner 2026-11-18: no pick count under it; a kids age guide keeps
 *  its age band, which says which guide it is). Opens /gift-guides/<slug>. */
export function GiftGuideTile({ g, label }: { g: CatalogGuide; label?: string }) {
  const saved = useGiftList().guides.includes(g.slug);
  return (
    <li className="gg-tile-li">
      {/* Owner 2026-11-18: a heart on the cover's top-right saves the guide to My list; it is the link's sibling, so
          tapping it never opens the guide. */}
      <Heart saved={saved} label={`Save ${label ?? g.title} to My list`} onToggle={() => toggleGuide(g.slug)} className="gg-heart-tile" />
      <Link to={`/gift-guides/${g.slug}`} className="gg-tile" data-gift-tile={g.slug}>
        <GiftGuideCover guide={g} />
        <span className="gg-name">{label ?? g.title}</span>
        {g.age && <span className="gg-count">{g.age}</span>}
      </Link>
    </li>
  );
}
