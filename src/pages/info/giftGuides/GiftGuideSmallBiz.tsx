import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { SMALL_BIZ_SLUG, SMALL_BIZ_WORDS as W, smallBizDay, smallBizFeatured, smallBizTitle, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { loadModule, untilReload } from "@/lib/loadModule";
import { WISH } from "@/content/giftWishList";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { SB_CARD_CSS } from "./smallBizCardStyles";
import { GiftGuideLoadError } from "./GiftGuideLoadError";

/**
 * The Small Business Saturday sponsors (owner 2026-11-19 ~7:05 PM: "Yes do small business with our small business
 * sponsors"; ~7:15 PM: "We can link their facebooks or website for people to reach out"). Owner 2026-11-21: their page
 * is the Small Business Saturday deals day, /gift-guides/small-business-saturday (GiftGuideDeals.tsx renders
 * SmallBizGrid); the old standalone page with its category sections was removed, its free listings and sign-up form
 * live on /shop-small. Each card the business's logo (or its name), name and town, a one-line description, its best gift idea, a "25 Days
 * sponsor" badge (never a giveaway day), whether it ships, and "Visit" (website, else Facebook, else Instagram) with
 * its Facebook and Instagram beside it. These are the businesses' own pages, not affiliate links: plain links that open
 * in a new tab (rel noopener). Featured on the landing Nov 24-29; after Nov 29 the page is "Shop Small Louisiana".
 * The file loads only when this page opens. Guard: src/test/giftGuideSmallBiz1120.test.tsx.
 */

const SMALL_BIZ_CSS = `
.gg-sb-intro{margin:10px 0 4px;font-size:15px;line-height:1.5;color:var(--gg-ink);max-width:46rem}
${SB_CARD_CSS}
.gg-sb-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-sb-feature b{display:block;font-size:16px}
.gg-sb-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-sb-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;

/** The businesses file, loaded alone (loadModule: a prevented preload gives null and the page keeps its loading line). */
const loadSmallBiz = () => loadModule(() => import("@/content/giftGuideSmallBiz.json"));

/** A business's own page, in a new tab (not an affiliate link: no "sponsored"). */
function Out({ href, className, children, label }: { href: string; className?: string; children: React.ReactNode; label?: string }) {
  // Only an https page opens (the generator keeps https links only; this holds whatever the file says).
  if (!/^https:\/\//.test(href)) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={label} data-gift-sb-out="">
      {children}
    </a>
  );
}

/** One business. `compact` (the deals page): no badge, no description and no extra links, so 37 cards stay calm. */
function SmallBizCard({ b, compact = false }: { b: SmallBiz; compact?: boolean }) {
  const [logoOk, setLogoOk] = useState(true);
  // My Wish List (owner 2026-11-20): a business hearts by its slug (its Visit link can move between site and Facebook).
  const id = itemId(`biz:${b.slug}`);
  const saved = isSaved(useGiftList(), id);
  return (
    <li className="gg-sb" data-gift-sb={b.slug}>
      <Heart saved={saved} label={WISH.saveLabel(b.name)} onToggle={() => heartTapped(togglePick({ href: b.href ?? "", name: b.name, guide: SMALL_BIZ_SLUG, id }))} className="gg-heart-sb" />
      <span className="gg-sb-logo">
        {b.logo && logoOk ? <img loading="lazy" decoding="async" src={b.logo} alt="" width={72} height={72} onError={() => setLogoOk(false)} /> : <b aria-hidden="true">{b.name}</b>}
      </span>
      <span className="gg-sb-body">
        <p className="gg-sb-name">{b.name}</p>
        <p className="gg-sb-town">{[b.town || "Louisiana", b.ships === "ships" ? W.ships : W.local].join(" · ")}</p>
        {!compact && <span className="gg-badges"><i className="gg-bdg gg-bdg-sponsor" data-gift-badge="sponsor">{W.badge}</i></span>}
        {!compact && b.description && <p className="gg-sb-text">{b.description}</p>}
        {b.gift && <p className="gg-sb-text" data-gift-sb-gift=""><b>{W.giftLabel}</b> {b.gift}</p>}
        {b.href && (
          <span className="gg-sb-links">
            <Button asChild variant="outline" size="sm" className="gg-sb-visit">
              <Out href={b.href}>
                {W.visit}<span className="sr-only"> {b.name} ({G.newTab})</span>
              </Out>
            </Button>
            {!compact && b.website && b.href !== b.website && <Out href={b.website} className="gg-link">{W.website}</Out>}
            {!compact && b.facebook && b.href !== b.facebook && <Out href={b.facebook} className="gg-link" label={`${b.name} on ${W.facebook} (${G.newTab})`}>{W.facebook}</Out>}
            {!compact && b.instagram && b.href !== b.instagram && <Out href={b.instagram} className="gg-link" label={`${b.name} on ${W.instagram} (${G.newTab})`}>{W.instagram}</Out>}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * The deals page's Small Business Saturday section (owner 2026-11-21): the confirmed Louisiana 25 Days sponsors as one
 * flat grid, in the file's order (category, then name), without the category headings, free listings or sign-up card
 * of the standalone page, so the deals page stays calm. The file loads when the section mounts.
 */
export function SmallBizGrid() {
  const [rows, setRows] = useState<SmallBiz[] | null>(null);
  // Holiday audit 1121: a failed businesses file says so with a Try again (a second failure reloads the page), never
  // the "no businesses" line, which is only for a real empty list.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => {
      console.warn("gift guides: businesses file failed", e);
      if (live) setFailed(true);
    };
    void loadSmallBiz().then(
      // null: the app's recovery reload took the failure; if no reload comes (untilReload rejects), say so too.
      (m) => (m ? live && setRows(m.default as SmallBiz[]) : untilReload().catch(fail)),
      fail,
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = () => {
    if (attempt > 0) {
      window.location.reload();
      return;
    }
    setFailed(false);
    setAttempt(1);
  };
  return (
    <>
      <style>{SMALL_BIZ_CSS}</style>
      {rows === null && failed ? (
        <GiftGuideLoadError message={W.failed} onRetry={retry} />
      ) : rows === null ? (
        <p className="gg-sb-town" role="status">{W.loading}</p>
      ) : rows.length === 0 ? (
        <p className="gg-sb-intro" data-gift-sb-none="">{W.none}</p>
      ) : (
        <ul className="gg-sb-grid" data-gift-sb-grid="">{rows.map((b) => <SmallBizCard key={b.slug} b={b} compact />)}</ul>
      )}
    </>
  );
}

/** The landing's featured slot, Nov 24 through Nov 29 in Louisiana (owner), then gone. */
export function SmallBizFeature({ now }: { now?: Date }) {
  const today = smallBizDay(now ?? new Date());
  if (!smallBizFeatured(today)) return null;
  return (
    <>
      <style>{SMALL_BIZ_CSS}</style>
      <Link to={`/gift-guides/${SMALL_BIZ_SLUG}`} className="gg-sb-feature" data-gift-sb-feature="">
        <span>
          <b>{smallBizTitle(today)}</b>
          <span>{W.featuredLine}</span>
          <i aria-hidden="true">{W.featuredCta} ›</i>
        </span>
      </Link>
    </>
  );
}

/** On the Shop Small Louisiana guide: the way to the sponsors' page. */
export function SmallBizLink() {
  const today = smallBizDay(new Date());
  return (
    <Link to={`/gift-guides/${SMALL_BIZ_SLUG}`} className="gg-sb-feature" data-gift-sb-link="">
      <span>
        <b>{smallBizTitle(today)}</b>
        <span>{W.featuredLine}</span>
        <i aria-hidden="true">{W.featuredCta} ›</i>
      </span>
    </Link>
  );
}
