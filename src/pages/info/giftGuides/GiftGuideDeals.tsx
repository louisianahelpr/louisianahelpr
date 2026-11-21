import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { giftGuides as G } from "@/content/giftGuides";
import { DEALS_SLUG, DEALS_WORDS as W, dealStartsLater, dealsFeatured, dealsIn, dealsTitle, eventOrder, eventPhase, liveDeals, louisianaDay, shortDay, type Deal } from "@/content/giftGuideDeals.mjs";
import { GiftOut } from "./GiftOut";
import { loadModule } from "@/lib/loadModule";
import { HINTS, WISH } from "@/content/giftWishList";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { dealName } from "./wishListItems";
import { DealsAndCodes } from "./GiftGuidesSidebar";
import { SmallBizGrid } from "./GiftGuideSmallBiz";

/**
 * /gift-guides/black-friday-cyber-monday (owner 2026-11-19; owner 2026-11-21: "we still need to do the black friday
 * section, small business saturday, and cyber monday deals"): ONE page with three day sections, Black Friday (Nov 27),
 * Small Business Saturday (Nov 28) and Cyber Monday (Nov 30) (giftGuideDeals.mjs DEAL_EVENTS). Each section is its
 * heading, one line with its day (worded for before, on and after the day), then its cards. A section whose day has
 * passed moves below the ones still ahead and stays while its sales run (eventOrder); a deals section with nothing
 * left to show is left out. Deal cards: the brand, the sale in the brand's words, a CODE chip with a copy button when
 * there is a code, "Starts <day>" (announced, not started yet) or "Ends <day>", the photo and a Shop link with our
 * affiliate link. Never a price. The order inside a section is the generator's (our commission, high to low;
 * scripts/gift-guide-deals.mjs). A deal past its end day is hidden at view time (dealShows). The Small Business
 * Saturday section is the confirmed Louisiana 25 Days sponsors (GiftGuideSmallBiz.tsx SmallBizGrid). Deals live on
 * this page only, never inside Her, Him or Kids (owner 11-21). The data files load only when this page opens.
 * Guard: src/test/giftGuideDeals1119.test.tsx.
 */

const DEALS_CSS = `
.gg-deals-intro{margin:10px 0 4px;font-size:15px;line-height:1.5;color:var(--gg-ink);max-width:46rem}
.gg-deals-ad{margin:0 0 6px;font-size:12px;color:var(--gg-muted)}
.gg-deal-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.gg-deal-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1100px){.gg-deal-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.gg-deal{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink)}
.gg-deal-photo{display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;border-radius:10px;background:#fff;overflow:hidden;isolation:isolate;text-decoration:none}
.gg-deal-photo img{width:100%;height:100%;object-fit:contain;padding:8px;mix-blend-mode:multiply}
.gg-deal-photo b{font-size:15px;color:var(--gg-muted);padding:8px;text-align:center}
.gg-deal-brand{margin:2px 0 0;font-size:15px;font-weight:700;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal-text{margin:0;font-size:13px;line-height:1.4;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal-meta{margin:0;font-size:12px;color:var(--gg-muted)}
.gg-deal-code{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.gg-deal-code code{font-size:12px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;background:var(--gg-soft);color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal .gg-deal-shop{display:inline-flex;align-items:center;align-self:flex-start;min-height:44px;margin-top:auto;padding:0 4px 0 0;border:0;background:none;font-size:14px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-deal .gg-deal-shop:hover,.gg-deal .gg-deal-shop:focus-visible{text-decoration:underline}
.gg-deals-jump{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;margin:2px 0 0}
.gg-deals-jump span{font-size:12px;color:var(--gg-muted)}
@media (max-width:767px){.gg:has([data-gift-deals-page]) .gg-banner h1{-webkit-line-clamp:2;font-size:17px;line-height:1.1}}
.gg-deals-day{margin:-4px 0 12px;font-size:14px;line-height:1.45;color:var(--gg-ink);max-width:46rem}
.gg-deals-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-deals-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-deals-feature b{display:block;font-size:16px}
.gg-deals-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-deals-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;

/** The guide's cover (public/gift-guides/deals/, drawn by scripts/gift-guide-deals-cover.py). */
export const DEALS_COVER = "/gift-guides/deals/black-friday-cyber-monday.webp";

/** The deals file, loaded alone (the read runs after it, outside Vite's preload wrapper: dynamicImportThenDoesNoWork). */
// loadModule: a prevented preload (a recovery reload in flight) gives null, and the page keeps "Loading deals…".
const loadDeals = () => loadModule(() => import("@/content/giftGuideDeals.json"));

/** One deal's card. */
function DealCard({ deal, today }: { deal: Deal; today: string }) {
  const [copied, setCopied] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);
  // My Wish List (owner 2026-11-20): a deal card hearts like any gift; its ref is the deals page and its link's id.
  const id = itemId(deal.href);
  const saved = isSaved(useGiftList(), id);
  const name = dealName(deal);
  // An announced deal not started yet says when it starts; otherwise its end day, when it has one.
  const when = dealStartsLater(deal, today) ? W.startsOn(deal.starts!) : deal.ends ? W.endsOn(deal.ends) : "";
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      // Clipboard refused (permissions or an old browser): the code stays on screen to copy by hand.
      () => setCopied(false),
    );
  };
  return (
    <li className="gg-deal" data-gift-deal={deal.brand}>
      <GiftOut href={deal.href} className="gg-deal-photo">
        {deal.image && photoOk ? (
          <img loading="lazy" decoding="async" src={deal.image} alt={deal.item ?? ""} width={200} height={200} referrerPolicy="no-referrer-when-downgrade" onError={() => setPhotoOk(false)} />
        ) : (
          <b aria-hidden="true">{deal.brand}</b>
        )}
        <span className="sr-only">{W.shop(deal.brand)} ({G.newTab})</span>
      </GiftOut>
      <Heart saved={saved} label={WISH.saveLabel(name)} onToggle={() => heartTapped(togglePick({ href: deal.href, name, guide: DEALS_SLUG, id }))} className="gg-heart-deal" />
      <p className="gg-deal-brand">{deal.brand}</p>
      <p className="gg-deal-text" data-gift-deal-text="">{deal.deal}</p>
      {deal.code && (
        <p className="gg-deal-meta gg-deal-code" data-gift-deal-code={deal.code}>
          <span>{W.codeLabel}</span>
          <code>{deal.code}</code>
          <InlineTextButton className="no-underline" onClick={() => copy(deal.code!)} aria-label={`${G.copyCode} ${deal.code}`}>
            {copied ? G.copiedCode : G.copyCode}
          </InlineTextButton>
        </p>
      )}
      {(when || deal.store) && (
        <p className="gg-deal-meta" data-gift-deal-dates="">
          {[when, deal.store ? G.onStore(deal.store) : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      {/* Owner 11-20 ("too busy looking"): a plain text link like every pick's, no pill. */}
      <GiftOut href={deal.href} className="gg-deal-shop">
        <span data-gift-shop="">{W.shop(deal.brand)}</span>
        <span aria-hidden="true">&nbsp;›</span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
    </li>
  );
}

/** The deals page's body. `now` is for tests; the page passes nothing and reads the clock. */
export function GiftGuideDeals({ now }: { now?: Date }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadDeals().then(
      (m) => live && m && setDeals(m.default as Deal[]),
      // The chunk failed to load (offline, a stale deploy): the page says the deals are gone rather than spin.
      () => live && setDeals([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const today = louisianaDay(now ?? new Date());
  const shown = deals ? liveDeals(deals, today) : [];
  // The day sections in page order; a deals section with nothing left to show is left out (the sponsors always stay).
  const sections = eventOrder(today).filter((e) => e.kind === "small-biz" || dealsIn(shown, e.id).length > 0);
  return (
    <div data-gift-deals-page="">
      <style>{DEALS_CSS}</style>
      <p className="gg-deals-intro">{W.intro}</p>
      <p className="gg-deals-ad" data-gift-deals-ad="">{W.disclosure}</p>
      {/* Owner 2026-11-20 hints: the deals page's helper line. */}
      <p className="gg-deals-ad" data-gift-deals-help="">{HINTS.deals}</p>
      {/* Owner 11-21 ("i dont see the discount codes or sales"): the store codes and sales live on this page, open, and
          nowhere else on the landing ("Codes and deals shouldn't randomly show in sections"). */}
      <DealsAndCodes open />
      {deals === null ? (
        <p className="gg-deal-meta" role="status">{W.loading}</p>
      ) : (
        <>
          <nav className="gg-deals-jump" aria-label={W.jumpLabel} data-gift-deals-jump="">
            {sections.map((e) => (
              <a key={e.id} href={`#${e.id}`} className="gg-link">
                {/* Phones: the names only (the day line under each heading says the date), so the row stays short. */}
                {e.title}<span className="hidden sm:inline">&nbsp;· {shortDay(e.day)}</span>
              </a>
            ))}
          </nav>
          {sections.map((e) => {
            const list = e.kind === "deals" ? dealsIn(shown, e.id) : [];
            return (
              <section key={e.id} id={e.id} aria-labelledby={`${e.id}-title`} data-gift-deal-section={e.id} data-gift-deal-phase={eventPhase(e, today)} className="scroll-mt-24">
                <div className="gg-rowhead">
                  <h2 id={`${e.id}-title`}>{e.title}{e.kind === "deals" && <span className="gg-rowcount">&nbsp;({list.length})</span>}</h2>
                </div>
                <p className="gg-deals-day" data-gift-deal-day="">{e[eventPhase(e, today)]}</p>
                {e.kind === "deals" ? (
                  <ul className="gg-deal-grid">{list.map((d) => <DealCard key={`${d.brand} ${d.href}`} deal={d} today={today} />)}</ul>
                ) : (
                  <SmallBizGrid />
                )}
              </section>
            );
          })}
          {sections.every((e) => e.kind === "small-biz") && (
            <p className="gg-deals-intro" data-gift-deals-none="">
              {W.none} <Link to="/gift-guides" className="gg-link">{W.noneCta}</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The landing's featured slot (owner brief 2026-11-19): at the very top of /gift-guides from Nov 23 through Dec 1 in
 * Louisiana, then gone; after Dec 1 the guide itself is "Holiday Deals" (dealsTitle).
 */
export function DealsFeature({ now }: { now?: Date }) {
  const today = louisianaDay(now ?? new Date());
  if (!dealsFeatured(today)) return null;
  return (
    <>
      <style>{DEALS_CSS}</style>
      <Link to={`/gift-guides/${DEALS_SLUG}`} className="gg-deals-feature" data-gift-deals-feature="">
        <img src={DEALS_COVER} alt="" width={88} height={88} decoding="async" />
        <span>
          <b>{dealsTitle(today)}</b>
          <span>{W.featuredLine}</span>
          <i aria-hidden="true">{W.featuredCta} ›</i>
        </span>
      </Link>
    </>
  );
}
