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
import { Button } from "@/components/ui/button";
import { KIDS_BY_AGE_ID, KidsByAge } from "./GiftGuideAges";
import { DealsFeature } from "./GiftGuideDeals";
import { SmallBizFeature } from "./GiftGuideSmallBiz";
import { GatedBanners, GiftFinder } from "./GiftGuideFinder";
import { GiftCountdown, GiftTools } from "./fun/GiftCountdown";
import { SponsorRow } from "./GiftGuideSponsorRow";

/**
 * /gift-guides opens straight to the guides (owner redesign 11-18 PM: "the page the guide opens to on the phone view I
 * don't like it"; phone and desktop alike): one sideways-scrolling row of cover tiles per group (By person (n), For kids
 * (n), By budget (n), Louisiana (n)...), each with "See all" (/gift-guides?group=<row>: that group's guides as a
 * wrapped grid). Each tile opens /gift-guides/<slug>. "Our Top 10" is a short sideways strip of photo cards after the
 * first rows, then the rest of the rows, then the collapsed "Deals & codes" section.
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
const rowTiles = (row: GuideRow): { g: CatalogGuide; label?: string }[] => [
  ...guidesIn(row).map((g) => ({ g, label: hubCaption(row, g) })),
  ...(row === "for-kids"
    ? TEEN_TILES.flatMap(({ slug, label }) => {
        const g = guideBySlug(slug);
        return g && !g.empty ? [{ g, label }] : [];
      })
    : []),
];

/** The rows above the Top 10 strip (holistic review 11-18 M9: Top 10 sat 5th; now right after By person). */
const ROWS_BEFORE_TOP = 1;
/** The first row's covers that load at once (holistic review 11-18 M10); the rest stay lazy. */
const PRIORITY_COVERS = 4;
/** A landing group with this many guides or fewer sits beside its small neighbours (owner 11-20 12:30 PM plan). */
const SMALL_GROUP = 3;

/**
 * The quick-pick chips under the search (holistic review 11-18 M9): the shopper tasks the review timed (a budget,
 * stocking stuffers, a kid by age, him, her, Louisiana), one tap each. A chip whose guide holds nothing is left out.
 */
export const QUICK_PICKS: { label: string; to: string; slug?: string }[] = [
  // Follow-up 1120: Under $25, Under $50 and Stocking Stuffers are sections of Gifts by Budget.
  { label: "Under $25", to: "/gift-guides/gifts-by-budget#under-25", slug: "gifts-by-budget" },
  { label: "Under $50", to: "/gift-guides/gifts-by-budget#under-50", slug: "gifts-by-budget" },
  { label: "Stocking stuffers", to: "/gift-guides/gifts-by-budget#stocking-stuffers", slug: "gifts-by-budget" },
  // Big batch 1120 (owner-approved quick picks, in her order: Under $25, Under $50, Stocking Stuffers, Her, Him, Kids, Louisiana).
  { label: "Her", to: "/gift-guides/her", slug: "her" },
  { label: "Him", to: "/gift-guides/him", slug: "him" },
  // gg-r3 UX audit #17: the chip opens the Kids by age block itself (KidsByAge scrolls to its anchor).
  { label: "Kids", to: `/gift-guides?group=for-kids#${KIDS_BY_AGE_ID}` },
  { label: "Louisiana", to: "/gift-guides?group=louisiana" },
];

function QuickPicks() {
  const chips = QUICK_PICKS.filter((c) => !c.slug || (guideBySlug(c.slug) && !guideBySlug(c.slug)!.empty));
  return (
    <nav className="gg-picks" aria-label={G.quickPicksLabel} data-gift-quick-picks="">
      <ul className="gg-chips gg-picks-row">
        {chips.map((c) => (
          <li key={c.to}>
            <Button asChild variant="outline" size="sm" className="gg-chip">
              <Link to={c.to} data-gift-quick-pick={c.to}>{c.label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
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

export function GiftGuideLanding({ group }: { group: GuideRow | null }) {
  const rows = group ? ROWS.filter((r) => r.row === group) : ROWS;
  const drawRow = ({ row, label, tint }: (typeof ROWS)[number]) => {
    const headingId = `gift-row-${row}`;
    // Owner 11-18 PM: each heading carries its guide count, "By person (24)": the guides this row (and See all) shows.
    const list = rowTiles(row);
    return (
      <section key={row} aria-labelledby={headingId} data-gift-row={row}>
        <div className="gg-rowhead">
          <h2 id={headingId}><i className={`gg-dot gg-${tint}`} aria-hidden="true" />{label}<span className="gg-rowcount" data-gift-row-count="">&nbsp;({list.length})</span></h2>
          {!group && (
            <Link to={`/gift-guides?group=${row}`} className="gg-link" data-gift-see-all={row}>
              {G.seeAllLabel} ›<span className="sr-only"> {label}</span>
            </Link>
          )}
        </div>
        {/* Holistic review 11-18 H1: the kids age guides, two taps from the landing. */}
        {row === "for-kids" && group && <KidsByAge />}
        <ul className={group ? "gg-wrap" : "gg-row"}>
          {list.map(({ g, label }, i) => <GiftGuideTile key={g.slug} g={g} label={label} priority={!group && row === ROWS[0].row && i < PRIORITY_COVERS} />)}
        </ul>
        {row === "for-kids" && !group && <KidsByAge />}
      </section>
    );
  };
  // Owner 11-20 12:30 PM ("very busy and not well organized"): the other guides are GROUPED. A group of SMALL_GROUP
  // guides or fewer sits beside its small neighbours (For kids + By budget, By career + Life moments + Pets + Colors)
  // instead of each taking a whole row; a bigger group keeps its own sideways row. ROWS order is kept.
  const clusters: (typeof ROWS)[number][][] = [];
  let lastSmall = false;
  for (const r of rows.slice(ROWS_BEFORE_TOP)) {
    const small = rowTiles(r.row).length <= SMALL_GROUP;
    if (small && lastSmall) clusters[clusters.length - 1].push(r);
    else clusters.push([r]);
    lastSmall = small;
  }
  return (
    <>
      {group && <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>}
      {/* Owner brief 2026-11-19: the deals guide sits at the very top, Nov 23 through Dec 1 (Louisiana). */}
      {!group && <DealsFeature />}
      {/* Big batch 1120: the Small Business Saturday page, Nov 24 through Nov 29 (Louisiana). */}
      {!group && <SmallBizFeature />}
      {/* Owner 11-20 12:30 PM landing plan, in her order: the big "Find a gift in 3 taps" call to action (the gift
          finder: who, budget, vibe; its answers in the URL), the countdown + Gift of the Day as ONE slim line, ONE
          quick-filter chip row, Shop by person, the Top 10, ONE row of four tool cards, the grouped other guides, Deals &
          codes, then the 25 Days sponsors' logo row near the bottom. No how-to box and no tip boxes. */}
      {!group && <GiftFinder />}
      {!group && <GiftCountdown />}
      {!group && <QuickPicks />}
      {/* Big batch 1120: the 25 Days banner and the Declutter link, OFF until the lead flips their flags. */}
      {!group && <GatedBanners />}
      {!group && <LastMinute />}
      <div className="gg-rows" data-gift-rows="">
        {(group ? rows : rows.slice(0, ROWS_BEFORE_TOP)).map(drawRow)}
      </div>
      {!group && <TopStrip />}
      {!group && <GiftTools />}
      {!group && (
        <div className="gg-rows" data-gift-rows="">
          {clusters.map((c) => (c.length > 1 ? <div key={c[0].row} className="gg-groups" data-gift-groups="">{c.map(drawRow)}</div> : drawRow(c[0])))}
        </div>
      )}
      {!group && <DealsAndCodes />}
      {!group && (
        // Louisiana Holiday Hub (owner-approved 2026-11-20): lights, events and holiday help, one tap from the guides.
        <aside className="gg-helpr" aria-label={G.holidayHub.title} data-gift-holiday-hub="">
          <div>
            <b>{G.holidayHub.title}</b>
            <span>{G.holidayHub.body}</span>
          </div>
          <Link to="/holidays" className="gg-helpr-btn" data-gift-holiday-hub-link="">{G.holidayHub.cta}</Link>
        </aside>
      )}
      {/* Train 1120b (owner 11-20 ~8:40 AM): the 25 Days sponsors' logo row; near the bottom since the 12:30 PM plan. */}
      {!group && <SponsorRow />}
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
