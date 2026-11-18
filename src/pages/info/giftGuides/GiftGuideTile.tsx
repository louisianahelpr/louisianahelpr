import { Link } from "react-router-dom";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideCover } from "./GiftGuideCover";

/** A guide's tile: its square cover and its name (owner 2026-11-18: no pick count under it; a kids age guide keeps
 *  its age band, which says which guide it is). Opens /gift-guides/<slug>. */
export function GiftGuideTile({ g }: { g: CatalogGuide }) {
  return (
    <li>
      <Link to={`/gift-guides/${g.slug}`} className="gg-tile" data-gift-tile={g.slug}>
        <GiftGuideCover guide={g} />
        <span className="gg-name">{g.title}</span>
        {g.age && <span className="gg-count">{g.age}</span>}
      </Link>
    </li>
  );
}
