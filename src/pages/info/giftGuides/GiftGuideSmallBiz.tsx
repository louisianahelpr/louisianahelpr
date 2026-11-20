import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { SHOP_SMALL_GUIDE, SMALL_BIZ_SLUG, SMALL_BIZ_WORDS as W, smallBizDay, smallBizFeatured, smallBizSections, smallBizTitle, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { loadModule } from "@/lib/loadModule";
import { WISH } from "@/content/giftWishList";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";

/**
 * /gift-guides/small-business-saturday (owner 2026-11-19 ~7:05 PM: "Yes do small business with our small business
 * sponsors"; ~7:15 PM: "We can link their facebooks or website for people to reach out"). One section per category,
 * each card the business's logo (or its name), name and town, a one-line description, its best gift idea, a "25 Days
 * sponsor" badge (never a giveaway day), whether it ships, and "Visit" (website, else Facebook, else Instagram) with
 * its Facebook and Instagram beside it. These are the businesses' own pages, not affiliate links: plain links that open
 * in a new tab (rel noopener). Featured on the landing Nov 24-29; after Nov 29 the page is "Shop Small Louisiana".
 * The file loads only when this page opens. Guard: src/test/giftGuideSmallBiz1120.test.tsx.
 */

const SMALL_BIZ_CSS = `
.gg-sb-intro{margin:10px 0 4px;font-size:15px;line-height:1.5;color:var(--gg-ink);max-width:46rem}
.gg-sb-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:12px}
@media (min-width:640px){.gg-sb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.gg-sb-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.gg-sb{display:flex;gap:12px;min-width:0;padding:12px;border:1px solid var(--gg-line);border-radius:14px;background:#fff}
.gg-sb-logo{flex:none;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:12px;background:#faf6ee;overflow:hidden}
.gg-sb-logo img{width:100%;height:100%;object-fit:contain}
.gg-sb-logo b{font-size:12px;line-height:1.15;text-align:center;padding:4px;color:var(--gg-olive);overflow-wrap:anywhere}
.gg-sb-body{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.gg-sb-name{margin:0;font-size:15px;font-weight:700;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-sb-town{margin:0;font-size:12px;color:var(--gg-muted)}
.gg-sb-text{margin:0;font-size:13px;line-height:1.4;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-sb-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:4px}
.gg-sb .gg-sb-visit{border-radius:999px;font-weight:700;color:var(--gg-olive);border-color:var(--gg-olive)}
.gg-sb-guide{display:inline-block;margin:16px 0 4px}
.gg-sb-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:#fff;color:var(--gg-ink);text-decoration:none}
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

function SmallBizCard({ b }: { b: SmallBiz }) {
  const [logoOk, setLogoOk] = useState(true);
  // My Wish List (owner 2026-11-20): a business hearts by its slug (its Visit link can move between site and Facebook).
  const id = itemId(`biz:${b.slug}`);
  const saved = isSaved(useGiftList(), id);
  return (
    <li className="gg-sb" data-gift-sb={b.slug}>
      {b.href && <Heart saved={saved} label={WISH.saveLabel(b.name)} onToggle={() => heartTapped(togglePick({ href: b.href!, name: b.name, guide: SMALL_BIZ_SLUG, id }))} className="gg-heart-sb" />}
      <span className="gg-sb-logo">
        {b.logo && logoOk ? <img src={b.logo} alt="" width={72} height={72} loading="lazy" decoding="async" onError={() => setLogoOk(false)} /> : <b aria-hidden="true">{b.name}</b>}
      </span>
      <span className="gg-sb-body">
        <p className="gg-sb-name">{b.name}</p>
        <p className="gg-sb-town">{[b.town || "Louisiana", b.ships === "ships" ? W.ships : W.local].join(" · ")}</p>
        <span className="gg-badges"><i className="gg-bdg gg-bdg-sponsor" data-gift-badge="sponsor">{W.badge}</i></span>
        {b.description && <p className="gg-sb-text">{b.description}</p>}
        {b.gift && <p className="gg-sb-text" data-gift-sb-gift=""><b>{W.giftLabel}</b> {b.gift}</p>}
        {b.href && (
          <span className="gg-sb-links">
            <Button asChild variant="outline" size="sm" className="gg-sb-visit">
              <Out href={b.href}>
                {W.visit(b.name)}<span className="sr-only"> ({G.newTab})</span>
              </Out>
            </Button>
            {b.website && b.href !== b.website && <Out href={b.website} className="gg-link">{W.website}</Out>}
            {b.facebook && b.href !== b.facebook && <Out href={b.facebook} className="gg-link" label={`${b.name} on ${W.facebook} (${G.newTab})`}>{W.facebook}</Out>}
            {b.instagram && b.href !== b.instagram && <Out href={b.instagram} className="gg-link" label={`${b.name} on ${W.instagram} (${G.newTab})`}>{W.instagram}</Out>}
          </span>
        )}
      </span>
    </li>
  );
}

/** The page's body. `now` is for tests. */
export function GiftGuideSmallBiz() {
  const [rows, setRows] = useState<SmallBiz[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadSmallBiz().then(
      (m) => live && m && setRows(m.default as SmallBiz[]),
      // The chunk failed to load (offline, a stale deploy): the page says so rather than spin.
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const sections = rows ? smallBizSections(rows) : [];
  return (
    <div data-gift-small-biz-page="">
      <style>{SMALL_BIZ_CSS}</style>
      <p className="gg-sb-intro">{W.intro}</p>
      {rows === null ? (
        <p className="gg-sb-town" role="status">{W.loading}</p>
      ) : sections.length === 0 ? (
        <p className="gg-sb-intro" data-gift-sb-none="">{W.none}</p>
      ) : (
        sections.map(({ category, rows: list }) => {
          const id = `gift-sb-${category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <section key={category} aria-labelledby={id} data-gift-sb-section={category}>
              <div className="gg-rowhead"><h2 id={id}>{category}<span className="gg-rowcount">&nbsp;({list.length})</span></h2></div>
              <ul className="gg-sb-grid">{list.map((b) => <SmallBizCard key={b.slug} b={b} />)}</ul>
            </section>
          );
        })
      )}
      <Link to={`/gift-guides/${SHOP_SMALL_GUIDE}`} className="gg-link gg-sb-guide" data-gift-sb-guide="">{W.guideLink} ›</Link>
    </div>
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
