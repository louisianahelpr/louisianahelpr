import { Link } from "react-router-dom";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideCover } from "./GiftGuideCover";
import { Heart, toggleGuide, useGiftList } from "./giftList";

/** A guide's tile: its square cover and its name (owner 2026-11-18: no pick count under it; a kids age guide keeps
 *  its age band, which says which guide it is). Opens /gift-guides/<slug>.
 *  Holistic review 11-18 L1: the cover already prints the guide's name in its arch, so the name under it is for screen
 *  readers only (a renamed tile, "Teen girls", keeps it visible: its cover says only "Teens"); and the heart sits under
 *  the cover, right-aligned, never on top of the cover's products. */
export function GiftGuideTile({ g, label, priority = false }: { g: CatalogGuide; label?: string; priority?: boolean }) {
  const saved = useGiftList().guides.includes(g.slug);
  return (
    <li className="gg-tile-li">
      <Link to={`/gift-guides/${g.slug}`} className="gg-tile" data-gift-tile={g.slug}>
        <GiftGuideCover guide={g} priority={priority} />
        <span className={label ? "gg-name" : "gg-name sr-only"} data-gift-tile-name="">{label ?? g.title}</span>
        {g.age && <span className="gg-count">{g.age}</span>}
      </Link>
      {/* Owner 2026-11-18: a heart saves the guide to My list; it is the link's sibling, so tapping it never opens the
          guide. */}
      <Heart saved={saved} label={`Save ${label ?? g.title} to My list`} onToggle={() => toggleGuide(g.slug)} className="gg-heart-tile" />
    </li>
  );
}
