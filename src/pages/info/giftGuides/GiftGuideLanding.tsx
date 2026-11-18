import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guidesIn, type GuideRow } from "@/content/giftGuideCatalog";
import { GiftGuideTile } from "./GiftGuideTile";

/**
 * /gift-guides opens to the guides, not their items (owner 2026-11-18: "open to the sections first"; final design):
 * one sideways-scrolling row of cover tiles per group, each with "See all" (/gift-guides?group=<row>: that group's
 * guides as a wrapped grid). Each tile opens /gift-guides/<slug>.
 */
export function GiftGuideLanding({ group }: { group: GuideRow | null }) {
  const rows = group ? ROWS.filter((r) => r.row === group) : ROWS;
  return (
    <>
      {group && <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>}
      {rows.map(({ row, label, tint }) => {
        const headingId = `gift-row-${row}`;
        return (
          <section key={row} aria-labelledby={headingId} data-gift-row={row}>
            <div className="gg-rowhead">
              <h2 id={headingId}><i className={`gg-dot gg-${tint}`} aria-hidden="true" />{label}</h2>
              {!group && (
                <Link to={`/gift-guides?group=${row}`} className="gg-link" data-gift-see-all={row}>
                  {G.seeAllLabel} ›<span className="sr-only"> {label}</span>
                </Link>
              )}
            </div>
            <ul className={group ? "gg-wrap" : "gg-row"}>
              {guidesIn(row).map((g) => <GiftGuideTile key={g.slug} g={g} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}
