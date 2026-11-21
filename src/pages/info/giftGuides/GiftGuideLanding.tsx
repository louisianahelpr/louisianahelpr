import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { GUIDES, ROWS, guidesIn, type CatalogGuide, type GuideRow } from "@/content/giftGuideCatalog";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { sponsorPage } from "@/content/sponsorPage";
import { GiftGuideTile } from "./GiftGuideTile";
import { SponsorRow } from "./GiftGuideSponsorRow";

/**
 * /gift-guides (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live ... should we jsut do him,
 * her and kids?"; after 11-20 PM's "The gift guide page is still a busy mess"): ONE title with its short subline, then
 * the three guides' cover tiles (For Her, For Him, Kids), the Holiday Hub link, then the 25 Days sponsors' row (its
 * "See all" opens the sponsors page) and the giveaways card. No Top 10, Gift of the Day, finder, deals, codes, budget, store or color
 * strips: they drew from the retired guides (src/content/giftGuideLive.mjs). Guard: src/test/giftGuideOnlyThree1121.test.ts.
 */

/** The 25 Days sponsors page is live but no gift guide: it is reached from the sponsors' row, never a tile. */
const SPONSORS_PAGE = "25-days-sponsors";

/** The landing's tiles: the live guides in the owner's order (Her, Him, Kids), each that holds picks. */
const liveGuideTiles = (): CatalogGuide[] =>
  LIVE_GUIDES_1121.filter((slug) => slug !== SPONSORS_PAGE).flatMap((slug) => {
    const g = GUIDES.find((x) => x.slug === slug && !x.view);
    return g && !g.empty ? [g] : [];
  });

/** A landing row's tiles: its guides (a group's page, /gift-guides?group=<row>). */
export const rowTiles = (row: GuideRow): { g: CatalogGuide; label?: string }[] => guidesIn(row).filter((g) => g.slug !== SPONSORS_PAGE).map((g) => ({ g }));

/** The first screen's covers load at once; there are only three. */
const PRIORITY_COVERS = 3;

function LiveGuides() {
  const tiles = liveGuideTiles();
  if (tiles.length === 0) return null;
  return (
    <section aria-labelledby="gift-browse" className="gg-browse" data-gift-browse="">
      <h2 id="gift-browse" className="gg-browse-title">{G.browseTitle}</h2>
      <ul className="gg-wrap" data-gift-live-guides="">
        {tiles.map((g, i) => <GiftGuideTile key={g.slug} g={g} priority={i < PRIORITY_COVERS} />)}
      </ul>
    </section>
  );
}

/** A group's page (/gift-guides?group=<row>, an old "See all" link): its live guides as a wrapped grid, with a way back. */
function GroupPage({ group }: { group: GuideRow }) {
  const r = ROWS.find((x) => x.row === group)!;
  const headingId = `gift-row-${r.row}`;
  // Owner 11-18 PM: the heading carries its guide count, "By person (2)".
  const list = rowTiles(r.row);
  return (
    <>
      <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>
      <div className="gg-rows" data-gift-rows="">
        <section aria-labelledby={headingId} data-gift-row={r.row}>
          <div className="gg-rowhead">
            <h2 id={headingId}><i className={`gg-dot gg-${r.tint}`} aria-hidden="true" />{r.label}<span className="gg-rowcount" data-gift-row-count="">&nbsp;({list.length})</span></h2>
          </div>
          <ul className="gg-wrap">
            {list.map(({ g, label }) => <GiftGuideTile key={g.slug} g={g} label={label} />)}
          </ul>
        </section>
      </div>
    </>
  );
}

export function GiftGuideLanding({ group }: { group: GuideRow | null }) {
  if (group) return <GroupPage group={group} />;
  return (
    <>
      <LiveGuides />
      {/* Louisiana Holiday Hub (owner-approved 2026-11-20): lights, events and holiday help, one tap from the guides. */}
      <aside className="gg-helpr" aria-label={G.holidayHub.title} data-gift-holiday-hub="">
        <div>
          <b>{G.holidayHub.title}</b>
          <span>{G.holidayHub.body}</span>
        </div>
        <Link to="/holidays" className="gg-helpr-btn" data-gift-holiday-hub-link="">{G.holidayHub.cta}</Link>
      </aside>
      {/* Train 1120b (owner 11-20 ~8:40 AM): the 25 Days sponsors' logo row; its "See all" opens the sponsors page. */}
      <SponsorRow />
      {/* Owner 2026-11-18: the 25 Days card. App.tsx has no shopper giveaway page (/25days is the sponsors' page), so
          it links to the Facebook page the giveaways run on. */}
      <aside className="gg-helpr" aria-label={G.giveaways.title} data-gift-giveaways="">
        <div>
          <b>{G.giveaways.title}</b>
          <span>{G.giveaways.body}</span>
        </div>
        <a href={sponsorPage.links.facebookPage} target="_blank" rel="noopener noreferrer" className="gg-helpr-btn" data-gift-social="">{G.giveaways.cta}</a>
      </aside>
    </>
  );
}
