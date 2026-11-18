import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { STORES, guideBySlug, type CatalogGuide, type CatalogPick } from "@/content/giftGuideCatalog";
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

export function PickRow({ pick }: { pick: CatalogPick }) {
  const saved = useGiftList().picks.some((p) => p.href === pick.href && p.name === pick.name);
  return (
    <li data-gift-pick="">
      <GiftOut href={pick.href} className="gg-item">
        {pick.image ? (
          <img className="gg-thumb" src={pick.image} alt="" width={52} height={52} loading="lazy" decoding="async" />
        ) : (
          <span className="gg-thumb gg-letter" aria-hidden="true" data-gift-letter="">{pick.name.trim().charAt(0).toUpperCase()}</span>
        )}
        <span className="gg-nm">
          {pick.name}
          <small>{pick.line ? `${pick.line} ` : ""}{G.onStore((pick.store === "louisiana" || pick.store === "sponsor") && pick.brand ? pick.brand : STORES[pick.store].name)}</small>
          {pick.badges && (
            <span className="gg-badges">
              {pick.badges.map((b) => <i key={b} className={`gg-bdg gg-bdg-${b}`} data-gift-badge={b}>{G.badges[b]}</i>)}
            </span>
          )}
        </span>
        <span className="gg-shop" aria-hidden="true">{G.shopLabel}</span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
      <Heart saved={saved} label={`Save ${pick.name} to My list`} onToggle={() => togglePick({ href: pick.href, name: pick.name })} className="gg-heart-pick" />
    </li>
  );
}

/** A guide's items: the numbered list, or "Picks coming soon", then its full-guide links. */
function GiftGuideList({ guide }: { guide: CatalogGuide }) {
  return (
    <>
      {guide.picks.length > 0 && (
        <ol className="gg-list" data-gift-list="">
          {guide.picks.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}
        </ol>
      )}
      {!guide.children && guide.picks.length === 0 && guide.links.length === 0 && (
        // Owner 2026-11-18: a guide with no picks yet opens a friendly note, never an empty list or a dead link.
        <div className="gg-soon" data-gift-coming-soon="">
          <h3>{G.comingSoonTitle}</h3>
          <p>{G.comingSoonBody}</p>
          <Link to="/gift-guides" className="gg-link">{G.allGuidesLabel}</Link>
        </div>
      )}
      {NAME_ONLY_SPONSORS[guide.slug] && (
        // A sponsor whose gift is left out (lead 2026-11-18: Hilma's probiotic, a health product) is still named.
        <p className="gg-also" data-gift-also-sponsoring="">{G.alsoSponsoring(NAME_ONLY_SPONSORS[guide.slug].join(", "))}</p>
      )}
      {guide.links.length > 0 && (
        <p className="gg-more">
          {guide.links.map((l) => <GiftOut key={l.href} href={l.href} className="gg-link">{G.fullGuideLabel}: {l.label}</GiftOut>)}
        </p>
      )}
    </>
  );
}

/** The guide where the Hire-a-Helpr box sits at the TOP (owner 2026-11-18). */
const GIFT_WRAP_GUIDE = "gift-wrap-and-cards";

export function GiftGuideView({ guide }: { guide: CatalogGuide }) {
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
      <GiftGuideList guide={guide} />
      {guide.slug !== GIFT_WRAP_GUIDE && <GiftGuideHelpr />}
    </article>
  );
}
