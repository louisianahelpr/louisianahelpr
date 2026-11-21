import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guideBySlug, guidesIn, topPicks, type CatalogGuide, type CatalogPick, type GuideRow } from "@/content/giftGuideCatalog";
import { PickThumb, storeLabel } from "./GiftGuideView";
import { PickPrice, PricesAsOf, showsPrice } from "@/components/giftGuides/PickPrice";
import { GiftGuideTile } from "./GiftGuideTile";
import { GiftOut } from "./GiftOut";
import { DealsAndCodes } from "./GiftGuidesSidebar";
import { sponsorPage } from "@/content/sponsorPage";
import { LAST_MINUTE, lastMinuteOn, shippingLine } from "@/content/giftGuideShipping";
import { KidsByAge } from "./GiftGuideAges";
import { DEALS_COVER, DealsFeature } from "./GiftGuideDeals";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { SmallBizFeature } from "./GiftGuideSmallBiz";
import { GatedBanners, GiftFinder } from "./GiftGuideFinder";
import { GiftCountdown, GiftTools } from "./fun/GiftCountdown";
import { SponsorRow } from "./GiftGuideSponsorRow";

/**
 * /gift-guides (owner 11-20 PM, from her phone: "The gift guide page is still a busy mess"): calm and organized, top to
 * bottom: ONE title with a short subline (the shipping words in it), the search row, the gift finder folded into one
 * "Find a gift in 3 taps" card, then ONE set of ways in, a tidy grid of photo cards (By person, For kids, By budget,
 * Louisiana, By store, Deals) with the smaller groups as one plain line of links under it; then the Top 10, the Gift
 * of the Day card, the tools, Deals & codes, the sponsors and the giveaways card. No chip strips and no sideways guide
 * rows on the landing: a group's card opens its page (/gift-guides?group=<row>, every guide as a wrapped grid), or the
 * guide itself when the group holds one. Guard: src/test/giftGuideLandingCalm1120.test.tsx.
 */
/**
 * The three Teens guides, also tiles in the For kids row (live audit r3 #4: they sat only under the Girls, Boys and
 * Gender-Neutral hubs, so the landing reached none), each named so the three read apart.
 */
// 1120: the Teens guides are sections of Girls, Boys and Gender-Neutral now (Kids by age links each); no tiles of their own.
export const TEEN_TILES: { slug: string; label: string }[] = [];
/**
 * A landing row's tiles: its guides, and on For kids the Teens guides that hold picks. The Girls, Boys and Gender-neutral
 * tiles carry a visible caption like the teen tiles (gg-r3 UX audit #10: only the teen tiles had one).
 */
const hubCaption = (row: GuideRow, g: CatalogGuide) => (row === "for-kids" && G.ageHubLabels[g.slug] ? g.title : undefined);
export const rowTiles = (row: GuideRow): { g: CatalogGuide; label?: string }[] => [
  ...guidesIn(row).map((g) => ({ g, label: hubCaption(row, g) })),
  ...(row === "for-kids"
    ? TEEN_TILES.flatMap(({ slug, label }) => {
        const g = guideBySlug(slug);
        return g && !g.empty ? [{ g, label }] : [];
      })
    : []),
];

/** The grid's covers that load at once (holistic review 11-18 M10: the first screen's covers); the rest stay lazy. */
const PRIORITY_COVERS = 4;

/** Where a group's way in goes: the guide itself when the group holds one, else the group's page. */
export const groupHref = (row: GuideRow) => {
  const tiles = rowTiles(row);
  return tiles.length === 1 ? `/gift-guides/${tiles[0].g.slug}` : `/gift-guides?group=${row}`;
};

/** The landing's photo cards: G.entries whose group holds guides (its photo the named guide's cover), then Deals. */
export function browseEntries(): { key: string; title: string; sub: string; to: string; cover: string | undefined }[] {
  const groups = G.entries.flatMap((e) => {
    const row = ROWS.find((r) => r.row === e.row)?.row;
    if (!row || rowTiles(row).length === 0) return [];
    const cover = guideBySlug(e.cover)?.cover ?? rowTiles(row).find((t) => t.g.cover)?.g.cover;
    return [{ key: row, title: e.title, sub: e.sub, to: groupHref(row), cover }];
  });
  return [...groups, { key: "deals", title: G.dealsEntry.title, sub: G.dealsEntry.sub, to: `/gift-guides/${DEALS_SLUG}`, cover: DEALS_COVER }];
}

/** The groups with no card of their own (Hobbies, By career, Life moments, Pets, Colors...), as one plain line of links. */
export const moreGroups = () => ROWS.filter((r) => !G.entries.some((e) => e.row === r.row) && rowTiles(r.row).length > 0);

function BrowseGrid() {
  const entries = browseEntries();
  const more = moreGroups();
  return (
    <section aria-labelledby="gift-browse" className="gg-browse" data-gift-browse="">
      <h2 id="gift-browse" className="gg-browse-title">{G.browseTitle}</h2>
      <ul className="gg-entries" data-gift-entries="">
        {entries.map((e, i) => (
          <li key={e.key}>
            <Link to={e.to} className="gg-entry" data-gift-entry={e.key}>
              {e.cover ? (
                <img className="gg-entry-photo" src={e.cover} alt="" width={480} height={480} decoding="async"
                  {...(i < PRIORITY_COVERS ? { loading: "eager" as const, fetchpriority: "high" } : { loading: "lazy" as const })} data-gift-cover="" />
              ) : (
                <span className="gg-entry-photo gg-check gg-green" aria-hidden="true" />
              )}
              <span className="gg-entry-title">{e.title}</span>
              <span className="gg-entry-sub">{e.sub}</span>
            </Link>
          </li>
        ))}
      </ul>
      {more.length > 0 && (
        <nav aria-label={G.moreTitle} className="gg-more-groups" data-gift-more-groups="">
          <span className="gg-more-groups-k">{G.moreTitle}</span>
          <ul>
            {more.map((r) => (
              <li key={r.row}><Link to={groupHref(r.row)} className="gg-link" data-gift-more-group={r.row}>{r.label}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}

/** A Top 10 card's name: the pick's name without a trailing parenthetical spec list ("… (10K, 30W, Built-in USB-C Cable)"). */
export const topCardName = (name: string) => name.replace(/\s*\([^()]*\)\s*$/, "") || name;

/** A Top 10 card: the photo (or the store's tile), a short name, the store, and the price on a non-Amazon pick. */
function TopCard({ pick, n }: { pick: CatalogPick; n: number }) {
  return (
    <li data-gift-pick="" data-gift-top-card="">
      <GiftOut href={pick.href} className="gg-topcard">
        {/* Design spec 11-18 M1: a 148px photo card with a small gold numeral, the only numbers on the pages. */}
        <span className="gg-topcard-photo">
          <PickThumb pick={pick} size={148} />
          <span className="gg-topcard-n" aria-hidden="true" data-gift-top-n="">{n}</span>
        </span>
        {/* gg-r3 UX audit #11: #1's long name was cut off at two lines; three lines, and a trailing "(…)" spec list
            dropped, fit every Top 10 name (the full name is the link's title). */}
        <span className="gg-topcard-name" title={pick.name}>{topCardName(pick.name)}</span>
        <span className="gg-topcard-meta">
          {storeLabel(pick) && <small>{storeLabel(pick)}</small>}
          <PickPrice pick={pick} />
        </span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
    </li>
  );
}

function TopStrip() {
  const top = topPicks();
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="gift-top-picks" data-gift-top="">
      <div className="gg-rowhead"><h2 id="gift-top-picks">{G.topTitle}</h2></div>
      <ul className="gg-row gg-toprow">{top.map((p, i) => <TopCard key={`${p.href} ${p.name}`} pick={p} n={i + 1} />)}</ul>
      {/* r4 audit Low #14: the "Prices as of" note only when most Top 10 cards show a price. */}
      {top.filter((p) => showsPrice(p)).length * 2 > top.length && <PricesAsOf picks={top} />}
    </section>
  );
}

/**
 * "Last-minute gifts" at the top of the landing, Dec 15 through Dec 25 in Louisiana (owner-approved 2026-11-18): the
 * Gift cards and Subscriptions guides (and an e-gifts guide once one holds picks) as tiles, with a short "Arrives by
 * Christmas" note carrying the shipping pill's own words for the day. Hidden on every other date.
 */
function LastMinute() {
  const now = new Date();
  if (!lastMinuteOn(now)) return null;
  const tiles = LAST_MINUTE.slugs.flatMap((slug) => {
    const g = guideBySlug(slug);
    return g && !g.empty ? [g] : [];
  });
  if (tiles.length === 0) return null;
  const ship = shippingLine(now);
  return (
    <section aria-labelledby="gift-last-minute" data-gift-last-minute="">
      <div className="gg-rowhead"><h2 id="gift-last-minute">{LAST_MINUTE.title}</h2></div>
      <p className="gg-ship gg-last-note" data-gift-last-minute-note="">
        {LAST_MINUTE.note}{ship ? `: ${ship}` : ""}
      </p>
      <ul className="gg-row">{tiles.map((g) => <GiftGuideTile key={g.slug} g={g} />)}</ul>
    </section>
  );
}

/** A group's page (/gift-guides?group=<row>, a card's "See all"): its guides as a wrapped grid, with a way back. */
function GroupPage({ group }: { group: GuideRow }) {
  const r = ROWS.find((x) => x.row === group)!;
  const headingId = `gift-row-${r.row}`;
  // Owner 11-18 PM: the heading carries its guide count, "By person (7)".
  const list = rowTiles(r.row);
  return (
    <>
      <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>
      <div className="gg-rows" data-gift-rows="">
        <section aria-labelledby={headingId} data-gift-row={r.row}>
          <div className="gg-rowhead">
            <h2 id={headingId}><i className={`gg-dot gg-${r.tint}`} aria-hidden="true" />{r.label}<span className="gg-rowcount" data-gift-row-count="">&nbsp;({list.length})</span></h2>
          </div>
          {/* Holistic review 11-18 H1: the kids age guides, two taps from the landing. */}
          {r.row === "for-kids" && <KidsByAge />}
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
      {/* Owner brief 2026-11-19: the deals guide sits at the very top, Nov 23 through Dec 1 (Louisiana). */}
      <DealsFeature />
      {/* Big batch 1120: the Small Business Saturday page, Nov 24 through Nov 29 (Louisiana). */}
      <SmallBizFeature />
      {/* Owner 11-20 PM: the finder is ONE compact card ("Find a gift in 3 taps ->"); its three steps open on a tap. */}
      <GiftFinder />
      {/* Big batch 1120: the 25 Days banner and the Declutter link, OFF until the lead flips their flags. */}
      <GatedBanners />
      <LastMinute />
      <BrowseGrid />
      <TopStrip />
      {/* Owner 11-20 PM: the countdown + Gift of the Day, lower down, as one small card (an affordable, priced pick). */}
      <GiftCountdown />
      <GiftTools />
      <DealsAndCodes />
      {/* Train 1120b (owner 11-20 ~8:40 AM): the 25 Days sponsors' logo row, near the bottom. */}
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
