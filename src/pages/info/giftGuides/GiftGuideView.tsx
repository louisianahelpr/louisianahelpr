import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { STORES, guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, relatedGuides, subscribeGuidePicks, type CatalogGuide, type CatalogPick } from "@/content/giftGuideCatalog";
import { GiftGuideTile } from "./GiftGuideTile";
import { GiftOut } from "./GiftOut";
import { GiftGuideHelpr } from "./GiftGuideHelpr";
import { NAME_ONLY_SPONSORS, SECTION_ALIASES, SECTION_ANCHORS } from "@/content/giftGuidePicks";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { HINTS, WISH } from "@/content/giftWishList";
import { Hint } from "./GiftHint";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { sortByPrice, type PriceOrder } from "@/content/giftGuidePriceSort";
import { PickPrice, PricesAsOf } from "@/components/giftGuides/PickPrice";
import { AgeChips } from "./GiftGuideAges";
import { PeopleChips } from "./GiftGuidePeopleChips";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import { SmallBizLink } from "./GiftGuideSmallBiz";
import { PrintablesLink } from "./printables/PrintablesLink";
import { SHOP_SMALL_GUIDE } from "@/content/giftGuideSmallBiz.mjs";
import { deadlineChip, louisianaToday } from "@/content/giftGuideExtras1120";

/**
 * One guide's body, /gift-guides/<slug> (owner's final design 2026-11-18; the back link and the gingham band sit
 * above the layout, in GiftGuides.tsx): the numbered list (number, a small product photo on white, the name, Shop; the whole
 * row opens the product). Built for lists of 25 (the owner is filling every guide to 25): every photo is lazy and
 * sized. A pick with no photo in the content file (every Amazon item: Amazon allows its product images only through
 * SiteStripe or its API, so none is scraped) gets a letter on white instead. A hub (Girls, Boys, Gender-Neutral) shows its
 * child guides' cover tiles (the five ages), then any picks of its own.
 */

/**
 * A pick's square thumbnail on the left (52px, lazy, contained on white, sized so nothing shifts), or a white tile with
 * its store's name when it has no photo or the photo fails to load (lead 2026-11-18: never a blank gap).
 */
/** The name a pick's row shows for its store: the brand for a Louisiana shop or a sponsor, else the store's. */
export const storeLabel = (pick: CatalogPick) =>
  (pick.store === "louisiana" || pick.store === "sponsor") && pick.brand ? pick.brand
  // ShopMy is no store a shopper knows (design audit r2 #9): the brand, or nothing.
  : pick.store === "shopmy" ? pick.brand ?? ""
  : STORES[pick.store].name;

/** A shopmy.us/collections/<id> link: a whole ShopMy collection, not the product (design audit r2 #3). */
const isShopMyCollection = (href: string) => /^https:\/\/shopmy\.us\/collections\//.test(href);

/** A loaded photo narrower than this is a blank pixel or a hotlink placeholder, not a product (owner 11-19: "no images?"). */
const MIN_PHOTO_WIDTH = 50;
/** True when a finished image is broken or too small to be a product photo. */
const photoFailed = (img: HTMLImageElement) => img.complete && img.naturalWidth < MIN_PHOTO_WIDTH;

export function PickThumb({ pick, size = 52 }: { pick: CatalogPick; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (pick.image && !failed) {
    // Owner 11-19 ("remove the white around these images"): the cream sits on the gg-photo box and the photo multiplies
    // onto it, so a white photo background blends into the card. A photo that already failed before React attached
    // onError (ref check), or that loads as a blank/tiny image (onLoad), draws the store tile instead.
    return (
      <span className="gg-photo">
        <img
          className="gg-thumb" loading="lazy" decoding="async" src={pick.image} alt="" width={size} height={size} referrerPolicy="no-referrer-when-downgrade"
          ref={(img) => { if (img?.currentSrc && photoFailed(img)) setFailed(true); }}
          onLoad={(e) => { if (photoFailed(e.currentTarget)) setFailed(true); }}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  // Lead 2026-11-18: a clean white tile with the store's name ("Amazon", "Walmart"), never a blank gap.
  return <span className="gg-thumb gg-letter" aria-hidden="true" data-gift-letter="">{storeLabel(pick)}</span>;
}

export function PickRow({ pick, guide }: { pick: CatalogPick; guide?: string }) {
  const saved = isSaved(useGiftList(), itemId(pick.href));
  // Big batch 1120: a pick wears Trending (or "Trending on TikTok") only from its own flag. The old "first 3 of a guide"
  // badge went with the featured order (owner 11-19 ~6:40 PM: every guide sorts by commission now).
  const badges = pick.badges;
  // A store's Christmas order-by day (src/content/giftGuideExtras1120.ts SHIP_DEADLINES), hidden after it passes.
  const today = louisianaToday(new Date());
  const ship = deadlineChip(pick.store, today);
  // A dated brand code (1120c: XTRATUF XT25, Nov 20-29) shows through its last day only.
  const code = pick.code && (!pick.codeEnds || today <= pick.codeEnds) ? pick.code : undefined;
  return (
    <li data-gift-pick="">
      {/* Owner 2026-11-21: "remove the shop at button, when they click the title of the image it will go there to the
          link". ONE link holds the photo and the name (calm: underlined on hover and focus only); the heart stays its
          own 44px button outside it. A screen reader hears "<name> (On <store>) ~$24 (opens in a new tab)". */}
      <GiftOut href={pick.href} className="gg-item" data-gift-title-link="">
        <PickThumb pick={pick} />
        {/* Owner 2026-11-21 ("how can we polish the listings so they aren't so busy looking? maybe remove the subtitle
            that describes the item. just show the price and not 'on whatever site'"): the name (2 lines at most), then
            the price alone. No why-line and no "On <store>"; the store is still said to screen readers (sr-only). */}
        <span className="gg-nm">
          <span className="gg-nm-name">{pick.name}</span>
          <span className="sr-only">{isShopMyCollection(pick.href) ? ` (${G.collectionOnShopMy})` : storeLabel(pick) ? ` (${G.onStore(storeLabel(pick))})` : ""}</span>
          <small className="gg-nm-meta"><PickPrice pick={pick} /></small>
          {(badges || code || ship) && (
            <span className="gg-badges">
              {badges?.map((b) => <i key={b} className={`gg-bdg gg-bdg-${b}`} data-gift-badge={b}>{G.badges[b]}</i>)}
              {code && <i className="gg-bdg gg-bdg-code" data-gift-code-chip="">{G.codeChip(code)}</i>}
              {ship && <i className="gg-bdg gg-bdg-ship" data-gift-ship-chip="">{ship}</i>}
            </span>
          )}
        </span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
      <Heart saved={saved} label={WISH.saveLabel(pick.name)} onToggle={() => heartTapped(togglePick({ href: pick.href, name: pick.name, ...(guide ? { guide } : {}) }))} className="gg-heart-pick" />
    </li>
  );
}

/** A guide's items: the numbered list, or (holding nothing) related guides, then its full-guide links. */
/**
 * A list split at each change of its picks' section (store-amazon's "Louisiana Helpr Picks", "By person"...; design
 * audit 11-18 #3). A list with no sections is one untitled run; a pick with none joins the run before it.
 */
const sectionsOf = (picks: CatalogPick[]) => {
  const runs: { title?: string; id?: string; picks: { start: number; rows: CatalogPick[] } }[] = [];
  picks.forEach((p, i) => {
    const last = runs[runs.length - 1];
    if (last && (!p.section || p.section === last.title)) last.picks.rows.push(p);
    else runs.push({ title: p.section, id: p.sectionId, picks: { start: i + 1, rows: [p] } });
  });
  return runs;
};

/** A merged guide's sections (1120), in order: [id, title, the pick count up to and including it]. */
const sectionNav = (picks: CatalogPick[]) => {
  const out: { id: string; title: string; end: number }[] = [];
  picks.forEach((p, i) => {
    if (!p.sectionId || !p.section) return;
    const last = out[out.length - 1];
    if (last && last.id === p.sectionId) last.end = i + 1;
    else out.push({ id: p.sectionId, title: p.section, end: i + 1 });
  });
  return out;
};

/** The budget filter's choices (owner-approved 11-19 9:05 PM): picks whose band is at most this. */
export const BUDGETS = [25, 50, 100] as const;
/** The picks a budget keeps: a known band at most the budget (the owner-list guides carry none: they sort by price instead). */
export const withinBudget = (picks: CatalogPick[], budget: number | null) => (budget ? picks.filter((p) => p.band !== undefined && p.band <= budget) : picks);
/** The filter shows on a guide holding at least this many priced picks. */
const BUDGET_MIN_PICKS = 3;

/** Rows a list draws at first, and each "Show more" adds (design audit 11-18 #3: 827 rows, 9,600 DOM nodes at once). */
export const PICKS_PAGE = 50;

/**
 * The picks that wear "Trending" (owner-approved 2026-11-18): the first TRENDING_TOP of a guide's list, in its
 * featured order (the order the import writes: trending picks first). Not on a store page, whose list is the store's
 * catalogue ranked by photo and gift score rather than a featured order. `position` is 1-based.
 */
/** "Show more" with this many or fewer left draws them all instead. */
const SHOW_ALL_UNDER = 6;

/** The person guides (giftGuideIndex "By person"): a merged section of one reads "For your father-in-law". */
const PERSON_SECTIONS = new Set(GUIDE_INDEX.filter((g) => g.group === "By person").map((g) => g.slug));
/**
 * A section's heading on a guide with more than one section (owner 11-20 on Dad, "Is the guide for dad or father in
 * law?": "Top picks" and "Father-in-Law" read as two titles side by side). The first reads "Top picks for Dad", a
 * merged person section "For your father-in-law", so each reads as a part of the one guide.
 */
export const sectionLabel = (guide: Pick<CatalogGuide, "title">, title: string, id?: string) => {
  if (/^top picks$/i.test(title.trim())) return `Top picks for ${guide.title}`;
  if (id && PERSON_SECTIONS.has(id)) return `For your ${title.toLowerCase()}`;
  return title;
};

function GiftGuideList({ guide }: { guide: CatalogGuide }) {
  const [shown, setShown] = useState(PICKS_PAGE);
  const [budget, setBudget] = useState<number | null>(null);
  // Her, Him, Kids and their relationship views (owner 11-21): low to high is the list as imported.
  const [order, setOrder] = useState<PriceOrder>("low");
  const sortable = isOwnerList(guide.slug);
  const ready = picksReady(guide.slug);
  // A merged guide's section link (/gift-guides/healthcare#rns, 1120): draw through that section, then scroll to it.
  const nav = ready ? sectionNav(guide.picks) : [];
  const jump = (id: string) => {
    const s = nav.find((x) => x.id === id);
    if (!s) return;
    setBudget(null);
    setShown((n) => Math.max(n, s.end));
    requestAnimationFrame(() => document.getElementById(`gg-sec-${id}`)?.scrollIntoView({ block: "start" }));
  };
  const navKey = nav.map((x) => x.id).join(" ");
  useEffect(() => {
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    // An old #section link (a section folded into a sibling, or an old guide's slug) opens its section now (1120d).
    const ids = navKey.split(" ");
    const id = ids.includes(raw) ? raw : SECTION_ALIASES[guide.slug]?.[raw] || SECTION_ANCHORS[raw] || "";
    if (id && ids.includes(id)) jump(id);
    // Once per guide, when its list is in (the hash is read only on arrival).
     
  }, [navKey]);
  if (!ready) return <p className="gg-soon" role="status" data-gift-picks-loading="">{G.loadingPicks}</p>;
  const related = guide.empty ? relatedGuides(guide) : [];
  const banded = guide.picks.filter((p) => p.band !== undefined).length;
  const inBudget = withinBudget(guide.picks, budget);
  const picks = sortable ? sortByPrice(inBudget, order) : inBudget;
  // Six or fewer left: draw them all, no "Show more (1 more)" (design audit r2 #16).
  const upTo = picks.length - shown <= SHOW_ALL_UNDER ? picks.length : shown;
  const left = picks.length - upTo;
  const runs = (from: number, to: number) => sectionsOf(picks.slice(0, to)).flatMap((r) => {
    const rows = r.picks.rows.filter((_, k) => r.picks.start + k > from);
    // A section cut by the deals keeps its heading only above its first part.
    const head = r.picks.start > from;
    return rows.length ? [{ title: head ? r.title : undefined, id: head ? r.id : undefined, picks: { start: r.picks.start + (r.picks.rows.length - rows.length), rows } }] : [];
  });
  const draw = (from: number, to: number) => runs(from, to).map(({ title, id, picks: run }, i) => (
        <section key={`${from} ${i} ${title ?? ""}`} data-gift-section={title ?? ""} id={id ? `gg-sec-${id}` : undefined} className={id ? "gg-sec" : undefined}>
          {title && <h3 className="gg-sec-title">{nav.length > 1 ? sectionLabel(guide, title, id) : title}</h3>}
          <ol className="gg-list" data-gift-list="" style={run.start > 1 ? { counterReset: `gg ${run.start - 1}` } : undefined}>
            {run.rows.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} guide={guide.slug} />)}
          </ol>
        </section>
      ));
  return (
    <>
      {nav.length > 1 && (
        <nav aria-label={G.sectionNavLabel} className="gg-secnav" data-gift-section-nav="">
          <span className="gg-secnav-label" aria-hidden="true">{G.sectionNavLabel}:</span>
          {nav.map((s) => (
            <a key={s.id} href={`/gift-guides/${guide.slug}#${s.id}`} className="gg-chip" data-gift-section-link={s.id} onClick={(e) => { e.preventDefault(); window.history.replaceState(window.history.state, "", `#${s.id}`); jump(s.id); }}>{sectionLabel(guide, s.title, s.id)}</a>
          ))}
        </nav>
      )}
      {sortable && guide.picks.length > 1 && (
        <div className="gg-sort" data-gift-sort="">
          <SegmentedControl<PriceOrder>
            ariaLabel={G.sortLabel}
            value={order}
            onChange={(o) => { setOrder(o); setShown(PICKS_PAGE); }}
            labelSize="md"
            options={[{ value: "low", label: G.sortLowHigh }, { value: "high", label: G.sortHighLow }]}
          />
        </div>
      )}
      {banded >= BUDGET_MIN_PICKS && <Hint id="budget">{HINTS.budget}</Hint>}
      {banded >= BUDGET_MIN_PICKS && (
        <div role="group" aria-label={G.budgetLabel} className="gg-budget" data-gift-budget="">
          {[null, ...BUDGETS].map((b) => (
            <ToggleChip key={b ?? "all"} pressed={budget === b} data-gift-budget-choice={b ?? "all"} onClick={() => { setBudget(b); setShown(PICKS_PAGE); }}>
              {b ? G.budgetUnder(b) : G.budgetAll}
            </ToggleChip>
          ))}
        </div>
      )}
      {budget !== null && <p className="gg-price-note" data-gift-budget-note="">{picks.length ? G.budgetNote : G.budgetNone}</p>}
      {draw(0, upTo)}
      <PricesAsOf picks={picks.slice(0, upTo)} />
      {left > 0 && (
        <Button type="button" variant="outline" size="inline" className="gg-more-picks" onClick={() => setShown((n) => n + PICKS_PAGE)} data-gift-more-picks="">
          {G.showMorePicks(left)}
        </Button>
      )}
      {!guide.children && guide.picks.length === 0 && guide.links.length === 0 && (
        // Owner 2026-11-18: a guide with no picks yet opens a friendly note, never an empty list or a dead link.
        <div className="gg-soon" data-gift-coming-soon="">
          <h3>{G.comingSoonTitle}</h3>
          <p>{G.comingSoonBody}</p>
          <Link to="/gift-guides" className="gg-link">{G.allGuidesLabel}</Link>
        </div>
      )}
      {related.length > 0 && (
        // Lead 2026-11-18: an empty guide's own link points to related guides that hold picks.
        <section aria-label={G.relatedTitle} data-gift-related="">
          <div className="gg-rowhead"><h3>{G.relatedTitle}</h3></div>
          <ul className="gg-wrap">{related.map((r) => <GiftGuideTile key={r.slug} g={r} />)}</ul>
        </section>
      )}
      {NAME_ONLY_SPONSORS[guide.slug] && (
        // A sponsor whose gift is left out (lead 2026-11-18: Hilma's probiotic, a health product) is still named.
        <p className="gg-also" data-gift-also-sponsoring="">{G.alsoSponsoring(NAME_ONLY_SPONSORS[guide.slug].join(", "))}</p>
      )}
      {/* Owner 11-18 PM ("my full guides are already here with the links"): no "Shop the full guide" or "More on
          ShopMy" collection lines; each pick carries its own link. */}
    </>
  );
}

/** Today in Louisiana, as YYYY-MM-DD (a deal shows through its end date). */
const todayInLouisiana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

/**
 * A store page's deals after ALL its picks (owner 2026-11-18: "add subsections for any store that has deals right now";
 * live audit r3 #1 High: Walmart's deals were ~3,500 px of photo-less rows and bare bold links BEFORE most picks). One
 * compact list in the Sales row style (the offer opening the deal, its end date on the same line): each deal page, then
 * the items a deal names that the picks above don't already hold (by link or name). The first few show, then
 * "See all deals (n)". A deal past its end date is hidden.
 */
const liveDeals = (guide: CatalogGuide) => {
  const today = todayInLouisiana();
  return (guide.deals ?? []).filter((d) => !d.ends || d.ends >= today);
};

/** The deal rows a store page lists, each link once and none already a pick on the page. */
const storeDealRows = (guide: CatalogGuide) => {
  const norm = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Set<string>(guide.picks.flatMap((p) => [p.href, norm(p.name)]));
  const rows: { title: string; href: string; ends?: string }[] = [];
  const add = (title: string, href: string, ends?: string) => {
    if (seen.has(href) || seen.has(norm(title))) return;
    seen.add(href);
    seen.add(norm(title));
    rows.push({ title, href, ...(ends ? { ends } : {}) });
  };
  for (const d of liveDeals(guide)) {
    add(d.title, d.href, d.ends);
    for (const i of d.items ?? []) add(i.name, i.href, d.ends);
  }
  return rows;
};

/** Deal rows a store page shows before "See all deals". */
const STORE_DEALS_FIRST = 6;

function StoreDeals({ guide }: { guide: CatalogGuide }) {
  const [all, setAll] = useState(false);
  const rows = storeDealRows(guide);
  if (rows.length === 0) return null;
  return (
    <section aria-label={G.dealsTitle} className="gg-store-deals" data-gift-deals="">
      <div className="gg-rowhead"><h3>{G.dealsTitle}</h3></div>
      <ul>
        {(all ? rows : rows.slice(0, STORE_DEALS_FIRST)).map((d) => (
          <li key={d.href} data-gift-deal="">
            <GiftOut href={d.href} className="gg-link">{d.title}</GiftOut>
            {d.ends && <span className="gg-code-offer">{G.dealEnds(d.ends)}</span>}
          </li>
        ))}
      </ul>
      {!all && rows.length > STORE_DEALS_FIRST && (
        <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setAll(true)} data-gift-all-deals="">{G.allDealsLabel(rows.length)}</Button>
      )}
    </section>
  );
}

/** The guide where the Hire-a-Helpr box sits at the TOP (owner 2026-11-18). */
const GIFT_WRAP_GUIDE = "gift-wrap-and-cards";

export function GiftGuideView({ guide }: { guide: CatalogGuide }) {
  // PERF: the guide's picks are its own lazy chunk; re-render when it lands.
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    loadGuidePicks(guide.slug).catch((e: unknown) => {
      // A failed chunk (offline, a stale deploy) leaves the loading line; the route error boundary is for render errors.
      console.warn("gift guides: picks chunk failed", guide.slug, e);
    });
  }, [guide.slug]);
  return (
    <article aria-labelledby="gift-guide-title" data-gift-guide={guide.slug}>
      {guide.slug === GIFT_WRAP_GUIDE && <GiftGuideHelpr />}
      {/* Holistic review 11-18 H1: Niece, Nephew and Cousins open their kids age guides by age. */}
      <AgeChips slug={guide.slug} />
      {/* For Her + For Him (owner pop-up 11-20): Mom, Wife ... chips filter the same list (each its own page). */}
      {/* Owner 11-21: For Her is her own 25 saves, one flat list: no relationship chips. */}
      {!isOwnerList(guide.slug) && <PeopleChips guide={guide} />}
      {/* Big batch 1120: Shop Small Louisiana opens with the way to the Small Business Saturday page. */}
      {guide.slug === SHOP_SMALL_GUIDE && <SmallBizLink />}
      {/* Owner 2026-11-20: the free printables this guide links to (gift tags on Gift Wrap & Cards), once each is ready. */}
      <PrintablesLink slug={guide.slug} />
      {/* Holistic review 11-18 L3: how many gifts the guide holds, once its list is in. */}
      {picksReady(guide.slug) && guide.picks.length > 0 && (
        <p className="gg-itemcount" data-gift-item-count="">{G.itemCount(guide.picks.length)}</p>
      )}
      {guide.children?.map((group) => (
        <section key={group.label} aria-label={group.label} data-gift-hub-group={group.label}>
          <div className="gg-rowhead"><h3>{group.label}</h3></div>
          <ul className="gg-wrap">
            {group.slugs.map((c) => <GiftGuideTile key={c} g={guideBySlug(c)!} />)}
          </ul>
        </section>
      ))}
      {/* Owner 11-21 ("Codes and deals shouldn't randomly show in sections"): no "Deals & codes" box on any guide page;
          the codes and sales live only on the deals page, which the left menu opens. */}
      <GiftGuideList key={guide.slug} guide={guide} />
      {picksReady(guide.slug) && <StoreDeals key={`deals ${guide.slug}`} guide={guide} />}
      {guide.slug !== GIFT_WRAP_GUIDE && <GiftGuideHelpr />}
    </article>
  );
}
