import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { STORES, guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, relatedGuides, subscribeGuidePicks, type CatalogGuide, type CatalogPick } from "@/content/giftGuideCatalog";
import { GiftGuideTile } from "./GiftGuideTile";
import { GiftOut } from "./GiftOut";
import { GiftGuideHelpr } from "./GiftGuideHelpr";
import { NAME_ONLY_SPONSORS } from "@/content/giftGuidePicks";
import { Heart, togglePick, useGiftList } from "./giftList";

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
export const storeLabel = (pick: CatalogPick) => ((pick.store === "louisiana" || pick.store === "sponsor") && pick.brand ? pick.brand : STORES[pick.store].name);

function PickThumb({ pick }: { pick: CatalogPick }) {
  const [failed, setFailed] = useState(false);
  if (pick.image && !failed) {
    return <img className="gg-thumb" loading="lazy" decoding="async" src={pick.image} alt="" width={52} height={52} referrerPolicy="no-referrer-when-downgrade" onError={() => setFailed(true)} />;
  }
  // Lead 2026-11-18: a clean white tile with the store's name ("Amazon", "Walmart"), never a blank gap.
  return <span className="gg-thumb gg-letter" aria-hidden="true" data-gift-letter="">{storeLabel(pick)}</span>;
}

export function PickRow({ pick, guide }: { pick: CatalogPick; guide?: string }) {
  const saved = useGiftList().picks.some((p) => p.href === pick.href && p.name === pick.name);
  return (
    <li data-gift-pick="">
      <GiftOut href={pick.href} className="gg-item">
        <PickThumb pick={pick} />
        <span className="gg-nm">
          {pick.name}
          <small>{pick.line ? `${pick.line} ` : ""}{G.onStore(storeLabel(pick))}</small>
          {pick.badges && (
            <span className="gg-badges">
              {pick.badges.map((b) => <i key={b} className={`gg-bdg gg-bdg-${b}`} data-gift-badge={b}>{G.badges[b]}</i>)}
            </span>
          )}
        </span>
        <span className="gg-shop" aria-hidden="true">{G.shopLabel}</span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
      <Heart saved={saved} label={`Save ${pick.name} to My list`} onToggle={() => togglePick({ href: pick.href, name: pick.name, ...(guide ? { guide } : {}) })} className="gg-heart-pick" />
    </li>
  );
}

/** A guide's items: the numbered list, or (holding nothing) related guides, then its full-guide links. */
/** Rows a list draws at first, and each "Show more" adds (design audit 11-18 #3: 827 rows, 9,600 DOM nodes at once). */
export const PICKS_PAGE = 50;

function GiftGuideList({ guide }: { guide: CatalogGuide }) {
  const [shown, setShown] = useState(PICKS_PAGE);
  if (!picksReady(guide.slug)) return <p className="gg-soon" role="status" data-gift-picks-loading="">{G.loadingPicks}</p>;
  const related = guide.empty ? relatedGuides(guide) : [];
  const left = guide.picks.length - shown;
  return (
    <>
      {guide.picks.length > 0 && (
        <ol className="gg-list" data-gift-list="">
          {guide.picks.slice(0, shown).map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} guide={guide.slug} />)}
        </ol>
      )}
      {left > 0 && (
        <button type="button" className="gg-more-picks" onClick={() => setShown((n) => n + PICKS_PAGE)} data-gift-more-picks="">
          {G.showMorePicks(left)}
        </button>
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
      {guide.links.some((l) => !l.related) && (
        <p className="gg-more">
          {guide.links.filter((l) => !l.related).map((l) => <GiftOut key={l.href} href={l.href} className="gg-link">{G.fullGuideLabel}: {l.label}</GiftOut>)}
        </p>
      )}
      {guide.links.some((l) => l.related) && (
        <p className="gg-more" data-gift-related="">
          <span className="gg-more-label">{G.relatedLabel}:</span>
          {guide.links.filter((l) => l.related).map((l) => <GiftOut key={l.href} href={l.href} className="gg-link">{l.label}</GiftOut>)}
        </p>
      )}
    </>
  );
}

/** Today in Louisiana, as YYYY-MM-DD (a deal shows through its end date). */
const todayInLouisiana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

/**
 * A store page's deal sections after its picks (owner 2026-11-18: "add subsections for any store that has deals right
 * now"): each a heading that opens the deal page (affiliate link), its items when the loader has them (Walmart's
 * collections), and its end date. A section past its end date is hidden.
 */
function StoreDeals({ guide }: { guide: CatalogGuide }) {
  const today = todayInLouisiana();
  const live = (guide.deals ?? []).filter((d) => !d.ends || d.ends >= today);
  if (live.length === 0) return null;
  return (
    <section aria-label={G.dealsTitle} data-gift-deals="">
      <div className="gg-rowhead"><h3>{G.dealsTitle}</h3></div>
      {live.map((d) => (
        <div key={d.href} data-gift-deal="">
          <p className="gg-more">
            <GiftOut href={d.href} className="gg-link">{d.title}</GiftOut>
            {d.ends && <small> {G.dealEnds(d.ends)}</small>}
          </p>
          {d.items && d.items.length > 0 && (
            <ol className="gg-list">
              {d.items.map((i) => <PickRow key={`${i.href} ${i.name}`} pick={{ name: i.name, href: i.href, store: guide.slug }} />)}
            </ol>
          )}
        </div>
      ))}
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
      {guide.children?.map((group) => (
        <section key={group.label} aria-label={group.label} data-gift-hub-group={group.label}>
          <div className="gg-rowhead"><h3>{group.label}</h3></div>
          <ul className="gg-wrap">
            {group.slugs.map((c) => <GiftGuideTile key={c} g={guideBySlug(c)!} />)}
          </ul>
        </section>
      ))}
      <GiftGuideList key={guide.slug} guide={guide} />
      <StoreDeals guide={guide} />
      {guide.slug !== GIFT_WRAP_GUIDE && <GiftGuideHelpr />}
    </article>
  );
}
