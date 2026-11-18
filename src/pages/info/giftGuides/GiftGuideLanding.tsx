import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guidesIn, type GuideRow } from "@/content/giftGuideCatalog";
import { GiftGuideTile } from "./GiftGuideTile";
import { sponsorPage } from "@/content/sponsorPage";

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
      {!group && (
        // Owner 2026-11-18: the 25 Days card. App.tsx has no shopper giveaway page (/25days is the sponsors' page), so
        // it links to the Facebook page the giveaways run on.
        <aside className="gg-helpr" aria-label={G.giveaways.title} data-gift-giveaways="">
          <div>
            <b>{G.giveaways.title}</b>
            <span>{G.giveaways.body}</span>
          </div>
          <a href={sponsorPage.links.facebookPage} target="_blank" rel="noopener noreferrer" className="gg-helpr-btn" data-gift-social="">{G.giveaways.cta}</a>
        </aside>
      )}
    </>
  );
}
