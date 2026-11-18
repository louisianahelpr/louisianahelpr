import { useState } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guideBySlug, guidesIn, topPicks, type CatalogGuide, type GuideRow } from "@/content/giftGuideCatalog";
import { PickRow } from "./GiftGuideView";
import { GiftGuideTile } from "./GiftGuideTile";
import { sponsorPage } from "@/content/sponsorPage";

/**
 * /gift-guides opens to the guides, not their items (owner 2026-11-18: "open to the sections first"; final design):
 * one sideways-scrolling row of cover tiles per group, each with "See all" (/gift-guides?group=<row>: that group's
 * guides as a wrapped grid). Each tile opens /gift-guides/<slug>.
 */
/** The guides a phone sees first (owner 2026-11-18), before "More guides" opens every row. */
const START_HERE = ["mom", "dad", "her", "him", "kids", "under-25", "louisiana-made"];

export function GiftGuideLanding({ group }: { group: GuideRow | null }) {
  const rows = group ? ROWS.filter((r) => r.row === group) : ROWS;
  const [more, setMore] = useState(false);
  const start = START_HERE.map((s) => guideBySlug(s)).filter((g): g is CatalogGuide => Boolean(g && !g.empty));
  return (
    <>
      {group && <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>}
      {!group && topPicks().length > 0 && (
        // Owner 2026-11-18: the picks the most guides list, first on the landing.
        <section aria-labelledby="gift-top-picks" data-gift-top="">
          <div className="gg-rowhead"><h2 id="gift-top-picks">{G.topTitle}</h2></div>
          <ol className="gg-list">{topPicks().map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}</ol>
        </section>
      )}
      {!group && start.length > 0 && (
        <section aria-labelledby="gift-start" data-gift-start="">
          <div className="gg-rowhead"><h2 id="gift-start">{G.startTitle}</h2></div>
          <ul className="gg-row">{start.map((g) => <GiftGuideTile key={g.slug} g={g} />)}</ul>
        </section>
      )}
      {!group && (
        // On a phone the other rows wait behind this button (owner 2026-11-18); on a wider screen it is hidden and every
        // row shows.
        <button type="button" className="gg-more-btn" aria-expanded={more} onClick={() => setMore((m) => !m)} data-gift-more="">
          {more ? G.fewerGuidesLabel : G.moreGuidesLabel}
        </button>
      )}
      <div className={!group && !more ? "gg-rows gg-rows-folded" : "gg-rows"} data-gift-rows="">
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
      </div>
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
