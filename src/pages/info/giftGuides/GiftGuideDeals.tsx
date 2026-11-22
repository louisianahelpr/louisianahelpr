import { useEffect, useRef, useState } from "react";
import { DEALS_COVER } from "@/content/giftGuideDeals.mjs";
import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { discountCodes, giftGuides as G } from "@/content/giftGuides";
import { DEALS_SLUG, DEALS_WORDS as W, codesDay, dealCode, dealName, dealEnds, dealStartsLater, dealsFeatured, dealsIn, dealsTitle, eventOrder, eventPhase, liveDeals, louisianaDay, type Deal, type DealEvent } from "@/content/giftGuideDeals.mjs";
import { DEAL_CODES } from "@/content/giftGuidePicks";
import { cleanCodes } from "@/lib/giftGuideOfferCopy.mjs";
import { GiftOut } from "./GiftOut";
import { loadModule, untilReload } from "@/lib/loadModule";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { onAnyList, requestSaveFor } from "./saveForPeople";
import { usePlan } from "./fun/plannerStore";
import { DealsAndCodes } from "./GiftGuideDealsAndCodes";
import { SmallBizGrid } from "./GiftGuideSmallBiz";
import { GiftGuideLoadError } from "./GiftGuideLoadError";

/**
 * The deals days (owner 2026-11-19; owner 2026-11-21: "we still need to do the black friday section, small business
 * saturday, and cyber monday deals"; later "remove small business stuff from black friday stuff. like each day has its
 * own section, no need to put them all in 1"): each day is its own page, /gift-guides/black-friday (Nov 27),
 * /gift-guides/small-business-saturday (Nov 28) and /gift-guides/cyber-monday (Nov 30) (giftGuideDeals.mjs
 * DEAL_EVENTS), with no links between the days on the page. A day page is one line with its day (worded for before,
 * on and after the day; owner 11-21 "remove this": no intro, #ad or helper line), its own "Deals & codes" box (collapsed; only the codes and sales that
 * still work on that day, codesDay), then only its own cards. Deal cards: the brand, the sale in the brand's words, a CODE chip with a copy button when
 * there is a code, "Starts <day>" (announced, not started yet) or "Ends <day>", the photo and a Shop link with our
 * affiliate link. Never a price. The order is the generator's (our commission, high to low;
 * scripts/gift-guide-deals.mjs). A deal past its end day is hidden at view time (dealShows). The Small Business
 * Saturday page is the confirmed Louisiana 25 Days sponsors only (GiftGuideSmallBiz.tsx SmallBizGrid), no codes box
 * (none of the store codes is a sponsor's), and a link to /shop-small. Deals live on the day pages only, never inside
 * Her, Him or Kids (owner 11-21). The data files load only when a day page opens.
 * Guard: src/test/giftGuideDeals1119.test.tsx.
 */

const DEALS_CSS = `
.gg-deals-intro{margin:10px 0 4px;font-size:15px;line-height:1.5;color:var(--gg-ink);max-width:46rem}
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
.gg-deal-code button{min-height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--gg-olive);color:var(--gg-olive);background:transparent;font-weight:700;font-size:12px}
.gg-deal-code code{font-size:12px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;background:var(--gg-soft);color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal .gg-deal-shop{display:inline-flex;align-items:center;align-self:flex-start;min-height:44px;margin-top:auto;padding:0 4px 0 0;border:0;background:none;font-size:14px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-deal .gg-deal-shop:hover,.gg-deal .gg-deal-shop:focus-visible{text-decoration:underline}
@media (max-width:767px){.gg:has([data-gift-deals-page]) .gg-banner h1{-webkit-line-clamp:2;font-size:clamp(19px,6vw,24px);line-height:1.1}}
.gg-deals-day{margin:0 0 6px;font-size:14px;line-height:1.45;color:var(--gg-ink);max-width:46rem}
.gg-deals-list{margin-top:12px}
.gg-deals-small{display:inline-block;margin:16px 0 4px}
.gg-deals-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-deals-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-deals-feature b{display:block;font-size:16px}
.gg-deals-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-deals-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;

/** The guide's cover (public/gift-guides/deals/, drawn by scripts/gift-guide-deals-cover.py). */
export { DEALS_COVER };

/** The deals file, loaded alone (the read runs after it, outside Vite's preload wrapper: dynamicImportThenDoesNoWork). */
// loadModule: a prevented preload (a recovery reload in flight) gives null, and the page keeps "Loading deals…".
const loadDeals = () => loadModule(() => import("@/content/giftGuideDeals.json"));

/**
 * Every store code we list, with its expiry (the codes box's own list): a deal card's code and its end day follow it
 * (holiday audit 1121, High: XTRATUF's card kept the code XT25 after the box had dropped it on Nov 30).
 */
const STORE_CODES = [...discountCodes, ...cleanCodes(DEAL_CODES)];

/** One deal's card. */
function DealCard({ deal, today }: { deal: Deal; today: string }) {
  const [copied, setCopied] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);
  // My Wish List (owner 2026-11-20): a deal card hearts like any gift; its ref is the deals page and its link's id.
  const id = itemId(deal.href);
  // Owner 11-21: filled when the deal is on My Wish List or on anyone's list (saveForPeople).
  const [wish, plan] = [useGiftList(), usePlan()];
  const saved = isSaved(wish, id) || onAnyList(plan, deal.href);
  const name = dealName(deal);
  // An announced deal not started yet says when it starts; otherwise its end day, when it has one.
  const ends = dealEnds(deal, STORE_CODES);
  const when = dealStartsLater(deal, today) ? W.startsOn(deal.starts!) : ends ? W.endsOn(ends) : "";
  // The code chip goes once that code has expired, even on a card whose sale runs on.
  const code = dealCode(deal, today, STORE_CODES);
  const codeEl = useRef<HTMLElement>(null);
  // Holiday audit 1121: when the clipboard is refused (permissions, an old browser, no clipboard at all), the code's text
  // is selected so a long press or Cmd+C copies it; nothing happened before.
  const selectCode = () => {
    const el = codeEl.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const copy = (code: string) => {
    if (!navigator.clipboard) {
      selectCode();
      return;
    }
    void navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => {
        setCopied(false);
        selectCode();
      },
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
      <Heart saved={saved} label={WISH.saveForLabel(name)} onToggle={() => { if (!requestSaveFor({ href: deal.href, name, guide: DEALS_SLUG, ...(deal.image ? { image: deal.image } : {}) })) heartTapped(togglePick({ href: deal.href, name, guide: DEALS_SLUG, id })); }} className="gg-heart-deal" />
      <p className="gg-deal-brand">{deal.brand}</p>
      <p className="gg-deal-text" data-gift-deal-text="">{deal.deal}</p>
      {code && (
        <p className="gg-deal-meta gg-deal-code" data-gift-deal-code={code}>
          <span>{W.codeLabel}</span>
          <code ref={codeEl}>{code}</code>
          <InlineTextButton className="no-underline" onClick={() => copy(code)} aria-label={`${G.copyCode} ${code}`}>
            {copied ? G.copiedCode : G.copyCode}
          </InlineTextButton>
        </p>
      )}
      {/* Holiday audit 1121: no "On <store>" line (owner 11-21 took it off the item cards); only when it starts or ends. */}
      {when && (
        <p className="gg-deal-meta" data-gift-deal-dates="">{when}</p>
      )}
      {/* Owner 11-20 ("too busy looking"): a plain text link like every pick's, no pill. */}
      {/* Holiday audit 1121: "Shop ›" on one line like every card (a long "Shop <Brand>" wrapped and stranded the ›);
          the brand stays in the link's name for screen readers. */}
      <GiftOut href={deal.href} className="gg-deal-shop">
        <span data-gift-shop="">{W.shopShort}<span className="sr-only"> {deal.brand}</span></span>
        <span aria-hidden="true">&nbsp;›</span>
        <span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
    </li>
  );
}

/** One deals day's page. `now` is for tests; the page passes nothing and reads the clock. */
export function GiftGuideDeals({ day, now }: { day: DealEvent; now?: Date }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const kind = day.kind;
  // Holiday audit 1121: a failed deals file (offline, a blocked chunk) says so with a Try again; it used to read as
  // "These deals have ended", which is only for the real all-ended case. A second failure reloads the page.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // The Small Business Saturday page has no deal cards: it never loads the deals file.
    if (kind !== "deals") return;
    let live = true;
    const fail = (e: unknown) => {
      console.warn("gift guides: deals file failed", e);
      if (live) setFailed(true);
    };
    void loadDeals().then(
      // null: the app's recovery reload took the failure; if no reload comes (untilReload rejects), say so too.
      (m) => (m ? live && setDeals(m.default as Deal[]) : untilReload().catch(fail)),
      fail,
    );
    return () => {
      live = false;
    };
  }, [kind, attempt]);
  const retry = () => {
    if (attempt > 0) {
      window.location.reload();
      return;
    }
    setFailed(false);
    setAttempt(1);
  };
  const today = louisianaDay(now ?? new Date());
  // Only this day's cards, and only the ones still on (dealShows).
  const list = deals ? dealsIn(liveDeals(deals, today, STORE_CODES), day.id) : [];
  return (
    <div data-gift-deals-page="" data-gift-deal-day-page={day.id} data-gift-deal-phase={eventPhase(day, today)}>
      <style>{DEALS_CSS}</style>
      {/* Owner 2026-11-21 ("remove this"): no intro, "#ad" or helper line here; the footer's affiliate disclosure stays. */}
      <p className="gg-deals-day" data-gift-deal-day="">{day[eventPhase(day, today)]}</p>
      {kind === "deals" ? (
        <>
          {/* Owner 11-21: "[Deals & codes box] should open collapsed"; each day only the codes and sales that still work on it. */}
          <DealsAndCodes on={codesDay(day, today)} />
          {deals === null && failed ? (
            <GiftGuideLoadError message={G.dealsFailed} onRetry={retry} />
          ) : deals === null ? (
            <p className="gg-deal-meta" role="status">{W.loading}</p>
          ) : list.length === 0 ? (
            <p className="gg-deals-intro" data-gift-deals-none="">
              {W.none} <Link to="/gift-guides" className="gg-link">{W.noneCta}</Link>
            </p>
          ) : (
            <ul className="gg-deal-grid gg-deals-list" aria-labelledby="gift-guide-title" data-gift-deal-list={day.id}>
              {list.map((d) => <DealCard key={`${d.brand} ${d.href}`} deal={d} today={today} />)}
            </ul>
          )}
        </>
      ) : (
        <div className="gg-deals-list">
          <SmallBizGrid />
          <Link to="/shop-small" className="gg-link gg-deals-small" data-gift-deals-shop-small="">{W.shopSmall} ›</Link>
        </div>
      )}
    </div>
  );
}

/**
 * The landing's featured slot (owner brief 2026-11-19): at the very top of /gift-guides from Nov 23 through Dec 1 in
 * Louisiana, then gone; it opens the next deals day still ahead (eventOrder), "Holiday Deals" after Dec 1 (dealsTitle).
 */
export function DealsFeature({ now }: { now?: Date }) {
  const today = louisianaDay(now ?? new Date());
  if (!dealsFeatured(today)) return null;
  return (
    <>
      <style>{DEALS_CSS}</style>
      <Link to={`/gift-guides/${eventOrder(today)[0].id}`} className="gg-deals-feature" data-gift-deals-feature="">
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
