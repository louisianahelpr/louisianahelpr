import { Link } from "react-router-dom";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideCover } from "./GiftGuideCover";
import { giftGuides as G } from "@/content/giftGuides";

/** A guide's tile: its square cover and its name (owner 2026-11-18: no pick count under it; a kids age guide keeps
 *  its age band, which says which guide it is). Opens /gift-guides/<slug>.
 *  Holistic review 11-18 L1: the cover already prints the guide's name in its arch, so the name under it is for screen
 *  readers only (a renamed tile, "Teen girls", keeps it visible: its cover says only "Teens"). No heart: owner 11-21
 *  ("they don't need an option to heart the whole guide"); the items keep theirs. */
export function GiftGuideTile({ g, label, priority = false, count }: { g: CatalogGuide; label?: string; priority?: boolean; count?: number }) {
  return (
    <li className="gg-tile-li">
      <Link to={`/gift-guides/${g.slug}`} className="gg-tile" data-gift-tile={g.slug}>
        <GiftGuideCover guide={g} priority={priority} />
        {/* Lead 11-21 landing polish: with a count, a quiet visible line under the cover, "Her · 36 gifts". */}
        {count ? <span className="gg-tile-line" data-gift-tile-name="">{label ?? g.title}<span aria-hidden="true"> · </span><span className="sr-only">, </span>{G.tileCount(count)}</span>
          : <span className={label ? "gg-name" : "gg-name sr-only"} data-gift-tile-name="">{label ?? g.title}</span>}
        {g.age && <span className="gg-count">{g.age}</span>}
      </Link>
    </li>
  );
}
