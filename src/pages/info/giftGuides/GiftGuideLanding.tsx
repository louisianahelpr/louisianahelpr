import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { GUIDES, ROWS, guidesIn, type CatalogGuide, type GuideRow } from "@/content/giftGuideCatalog";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { sponsorPage } from "@/content/sponsorPage";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { FUN_TOOLS, FUN_WORDS } from "@/content/giftGuideFun1120";
import { PRINTABLES_PATH, PRINTABLES_WORDS, shownPrintables } from "@/content/printables";
import { GiftGuideTile } from "./GiftGuideTile";
import { SponsorRow } from "./GiftGuideSponsorRow";
import { GiftFinder } from "./GiftGuideFinder";

/**
 * /gift-guides (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live ... should we jsut do him,
 * her and kids?"; after 11-20 PM's "The gift guide page is still a busy mess"): ONE title with its short subline and the
 * search row, a hairline across the page (GiftGuides.tsx), then, top to bottom: the three guides' cover tiles (For Her,
 * For Him, Kids); the 25 Days giveaways card and its sponsors' row (owner 11-21: "move the 25 days of giveaways up so
 * people will see it better"); the gift finder ("Find a gift in 3 taps") and the fun tools (Swipe, Secret Santa, Gift
 * planner; owner 11-21: "i also dont see the fun features anymore like the quiz"); the free printables and the deals
 * page as two cards ("there will also need to be a free section for our tags"; the codes themselves live only on the
 * deals page); and the Holiday Hub link. No Top 10, Gift of the Day, budget, store or color strips: they drew from the
 * retired guides (src/content/giftGuideLive.mjs). Guard: src/test/giftGuideOnlyThree1121.test.tsx.
 */

/** Live slugs that are pages, not guide tiles: the 25 Days sponsors page (its row's "See all") and the deals page (its card). */
const NOT_TILES = new Set(["25-days-sponsors", DEALS_SLUG]);

/** The landing's tiles: the live guides in the owner's order (Her, Him, Kids), each that holds picks. */
const liveGuideTiles = (): CatalogGuide[] =>
  LIVE_GUIDES_1121.filter((slug) => !NOT_TILES.has(slug)).flatMap((slug) => {
    const g = GUIDES.find((x) => x.slug === slug && !x.view);
    return g && !g.empty ? [g] : [];
  });

/** A landing row's tiles: its guides (a group's page, /gift-guides?group=<row>). */
export const rowTiles = (row: GuideRow): { g: CatalogGuide; label?: string }[] => guidesIn(row).filter((g) => !NOT_TILES.has(g.slug)).map((g) => ({ g }));

/** The first screen's covers load at once; there are only three. */
const PRIORITY_COVERS = 3;

function LiveGuides() {
  const tiles = liveGuideTiles();
  if (tiles.length === 0) return null;
  return (
    <section aria-labelledby="gift-browse" className="gg-browse" data-gift-browse="">
      <h2 id="gift-browse" className="gg-browse-title">{G.browseTitle}</h2>
      <ul className="gg-wrap gg-wrap-three" data-gift-live-guides="">
        {tiles.map((g, i) => <GiftGuideTile key={g.slug} g={g} priority={i < PRIORITY_COVERS} />)}
      </ul>
    </section>
  );
}

/** The fun tools (owner 11-21): one card each, three across on a wide screen, one under the other on a phone. */
function FunTools() {
  return (
    <section aria-labelledby="gift-fun-tools" data-gift-tools="">
      <h2 id="gift-fun-tools" className="gg-browse-title">{FUN_WORDS.toolsTitle}</h2>
      <ul className="gg-fun-tools" data-gift-fun-tools="">
        {FUN_TOOLS.map((t) => (
          <li key={t.to}>
            <Link to={t.to} className="gg-fun-tool" data-gift-fun-tool={t.to}><b>{t.title}</b><span>{t.body}</span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The free printables and the deals page, two cards side by side (owner 11-21). Printables shows only what is ready with
 * its files in place (src/content/printables.ts shownPrintables: today the gift tags), each by its own name; the deals
 * card opens the deals page, where the codes and sales are.
 */
function FreebiesAndDeals() {
  const printables = shownPrintables();
  const thumbs = printables.flatMap((p) => (p.kind === "overlay" ? p.designs.slice(0, 3).map((d) => d.thumb ?? d.image) : [p.preview]));
  return (
    <ul className="gg-extras" data-gift-extras="">
      {printables.length > 0 && (
        <li>
          <Link to={PRINTABLES_PATH} className="gg-fun-tool gg-extra" data-gift-printables="">
            <span className="gg-extra-thumbs" aria-hidden="true">
              {thumbs.slice(0, 3).map((src) => <img key={src} src={src} alt="" width={56} height={56} loading="lazy" decoding="async" />)}
            </span>
            <span className="gg-extra-words">
              <b>{PRINTABLES_WORDS.tile.title}</b>
              <span>{PRINTABLES_WORDS.landingLine(printables.map((p) => p.title))}</span>
            </span>
          </Link>
        </li>
      )}
      <li>
        <Link to={`/gift-guides/${DEALS_SLUG}`} className="gg-fun-tool gg-extra" data-gift-deals-link="">
          <span className="gg-extra-words">
            <b>{G.dealsAndCodesLabel}</b>
            <span>{G.dealsLine}</span>
          </span>
        </Link>
      </li>
    </ul>
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
    <div className="gg-landing" data-gift-landing="">
      <LiveGuides />
      {/* Owner 2026-11-18: the 25 Days card; owner 11-21 moved it up, right under the guides. App.tsx has no shopper
          giveaway page (/25days is the sponsors' page), so it links to the Facebook page the giveaways run on. */}
      <aside className="gg-helpr" aria-label={G.giveaways.title} data-gift-giveaways="">
        <div>
          <b>{G.giveaways.title}</b>
          <span>{G.giveaways.body}</span>
        </div>
        <a href={sponsorPage.links.facebookPage} target="_blank" rel="noopener noreferrer" className="gg-helpr-btn" data-gift-social="">{G.giveaways.cta}</a>
      </aside>
      {/* Train 1120b (owner 11-20 ~8:40 AM): the 25 Days sponsors' logo row, beside its giveaways card; its "See all" opens the sponsors page. */}
      <SponsorRow />
      <GiftFinder />
      <FunTools />
      <FreebiesAndDeals />
      {/* Louisiana Holiday Hub (owner-approved 2026-11-20): lights, events and holiday help, one tap from the guides. */}
      <aside className="gg-helpr" aria-label={G.holidayHub.title} data-gift-holiday-hub="">
        <div>
          <b>{G.holidayHub.title}</b>
          <span>{G.holidayHub.body}</span>
        </div>
        <Link to="/holidays" className="gg-helpr-btn" data-gift-holiday-hub-link="">{G.holidayHub.cta}</Link>
      </aside>
    </div>
  );
}
