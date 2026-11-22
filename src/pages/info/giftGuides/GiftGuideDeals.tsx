import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { discountCodes, giftGuides as G } from "@/content/giftGuides";
import { DEALS_COVER, DEALS_SLUG, DEALS_WORDS as W, codesDay, dealCode, dealName, dealEnds, dealsFeatured, dealsIn, dealsTitle, eventOrder, eventPhase, liveDeals, louisianaDay, type Deal, type DealEvent } from "@/content/giftGuideDeals.mjs";
import { DEAL_CODES } from "@/content/giftGuidePicks";
import { cleanCodes } from "@/lib/giftGuideOfferCopy.mjs";
import { GiftOut } from "./GiftOut";
import { START_OPEN } from "./startOpen";
import { loadModule, untilReload } from "@/lib/loadModule";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { onAnyList, requestSaveFor } from "./saveForPeople";
import { usePlan } from "./fun/plannerStore";
import { CARD_CSS, CARD_WORDS, CodeCards, CodeChip, codeCardCount, SaleCards, codesOn, salesOn } from "./GiftGuideDealCards";
import { SmallBizGrid } from "./GiftGuideSmallBiz";
import { FeatureCta, FeatureCtaLink } from "./SmallBizFeatureCta";
import { report } from "@/lib/errorLogger";
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
@media (max-width:767px){.gg:has([data-gift-deals-page]) .gg-banner h1{-webkit-line-clamp:3;font-size:clamp(25px,8vw,34px);line-height:1.05}}
.gg-deals-list{margin-top:12px}
.gg-deal-sec{border-top:1px solid var(--gg-line);scroll-margin-top:84px}
@media (max-width:767px){.gg-deal-sec{scroll-margin-top:132px}}
.gg-deal-sec:last-child{border-bottom:1px solid var(--gg-line)}
.gg-deal-sec>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:8px;min-height:52px;padding:14px 0 10px}
.gg-deal-sec>summary::-webkit-details-marker{display:none}
.gg-deal-sec>summary::after{content:"+";margin-left:auto;font-size:18px;line-height:1;color:var(--gg-ink)}
.gg-deal-sec[open]>summary::after{content:"\\2212"}
.gg-deal-sec-title{margin:0;font-size:16px;font-weight:700;color:var(--gg-ink)}
.gg-deal-sec>.gg-deal-grid{padding-bottom:16px}
.gg-deals-small{display:inline-block;margin:16px 0 4px}
.gg-deals-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-deals-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-deals-feature b{display:block;font-size:16px}
.gg-deals-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-deals-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;


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
  const [photoOk, setPhotoOk] = useState(true);
  // My Wish List (owner 2026-11-20): a deal card hearts like any gift; its ref is the deals page and its link's id.
  const id = itemId(deal.href);
  // Owner 11-21: filled when the deal is on My Wish List or on anyone's list (saveForPeople).
  const [wish, plan] = [useGiftList(), usePlan()];
  const saved = isSaved(wish, id) || onAnyList(plan, deal.href);
  const name = dealName(deal);
  // An announced deal not started yet says when it starts; otherwise its end day, when it has one.
  const ends = dealEnds(deal, STORE_CODES);
  // Owner 2026-11-21: every card says when it starts and ends (both when both are known; never an invented day).
  const when = W.runs(deal.starts, ends);
  // The code chip goes once that code has expired, even on a card whose sale runs on.
  const code = dealCode(deal, today, STORE_CODES);
  return (
    <li className="gg-deal gg-store-card" data-gift-deal={deal.brand}>
      <GiftOut href={deal.href} className="gg-deal-photo">
        {deal.image && photoOk ? (
          <img loading="lazy" decoding="async" src={deal.image} alt={deal.item ?? ""} width={200} height={200} referrerPolicy="no-referrer-when-downgrade" onError={() => setPhotoOk(false)} />
        ) : (
          <b aria-hidden="true">{deal.brand}</b>
        )}
        <span className="sr-only">{W.shop(deal.brand)} ({G.newTab})</span>
      </GiftOut>
      <Heart saved={saved} label={WISH.saveForLabel(name)} onToggle={() => { if (!requestSaveFor({ href: deal.href, name, guide: DEALS_SLUG, ...(deal.image ? { image: deal.image } : {}) })) heartTapped(togglePick({ href: deal.href, name, guide: DEALS_SLUG, id })); }} className="gg-heart-deal" />
      {/* Polish audit 1122 #12: one card design on the deals days. A Top deal reads like a code or sale card: the brand's
          name is its link (no separate "Shop" line), and its code is the same one-piece chip (tap to copy). */}
      <GiftOut href={deal.href} className="gg-deal-brand gg-card-store" data-gift-deal-brand="">{deal.brand}<span className="sr-only"> ({G.newTab})</span></GiftOut>
      <p className="gg-deal-text" data-gift-deal-text="">{deal.deal}</p>
      {/* Holiday audit 1121: no "On <store>" line (owner 11-21 took it off the item cards); only when it starts or ends. */}
      {when && (
        <p className="gg-deal-meta" data-gift-deal-dates="">{when}</p>
      )}
      {code && (
        <div className="gg-card-actions" data-gift-deal-code={code}>
          <CodeChip code={code} />
        </div>
      )}
    </li>
  );
}

/**
 * The free approved "Featured local" listings and the sign-up card under the sponsors (guides lane 11-21: /shop-small
 * now opens this page, so nothing it showed is lost). Their reader (the Supabase client) loads in its own chunk after
 * the page draws; until it is in, or if it fails (reported), the sign-up card shows on its own, so the top link always
 * has its card.
 */
const loadLocal = () => loadModule(() => import("./SmallBizLocal"));
type LocalModule = typeof import("./SmallBizLocal");
function LazyLocalListings() {
  const [Local, setLocal] = useState<LocalModule["SmallBizLocal"] | null>(null);
  useEffect(() => {
    let live = true;
    void loadLocal().then(
      (m) => {
        if (m && live) setLocal(() => (m as LocalModule).SmallBizLocal);
      },
      (e) => report(e as Error, { tags: { source: "GiftGuideDeals.loadLocal" } }),
    );
    return () => {
      live = false;
    };
  }, []);
  return Local ? <Local sponsors={[]} /> : <FeatureCta />;
}

/**
 * A deals day's content in subsections by type (owner 2026-11-21: "it just needs to be cleaned up ... more organized"):
 * Top deals (the deal cards), Discount codes and Sales, each only when it has something on `day` (codesDay), each a
 * heading with its count that opens and closes, the first one open and the rest closed. A row of chips at the top
 * jumps to (and opens) each one. `dealCount` null = the deal cards are still loading (or failed): that subsection shows
 * the loading line or the Try again in its place.
 */
function DealSections({ day, deals, dealCount, shownCodes }: { day: string; deals: ReactNode; dealCount: number | null; shownCodes: ReadonlySet<string> }) {
  // Polish audit 1122 #12: a code a Top deal card already shows (XTRATUF's XT25) gets no second card under Discount codes.
  const codes = codesOn(day).filter((c) => !shownCodes.has(c.code.toUpperCase()));
  const sales = salesOn(day);
  const sections = [
    ...(dealCount !== 0 ? [{ id: "deals", title: CARD_WORDS.dealsTitle, count: dealCount, body: deals }] : []),
    ...(codes.length ? [{ id: "codes", title: CARD_WORDS.codesTitle, count: codeCardCount(codes), body: <CodeCards codes={codes} /> }] : []),
    ...(sales.length ? [{ id: "sales", title: CARD_WORDS.salesTitle, count: sales.length, body: <SaleCards stores={sales} /> }] : []),
  ];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (sections.length === 0) {
    return (
      <p className="gg-deals-intro" data-gift-deals-none="">
        {W.none} <Link to="/gift-guides" className="gg-link">{W.noneCta}</Link>
      </p>
    );
  }
  // Owner 2026-11-22 ("make everything open expanded. black friday, small business, cyber monday keep it all open"):
  // every subsection starts open (START_OPEN); a shopper can still close one.
  const isOpen = (id: string) => open[id] ?? START_OPEN;
  return (
    <div className="gg-deals-list" data-gift-deal-sections="">
      {/* Polish audit 1122 #30: no jump-chip row (36px chips that wrapped at 375 and repeated the headings right below). */}
      {sections.map((x) => (
        <details key={x.id} id={`gg-deal-sec-${x.id}`} className="gg-deal-sec" open={isOpen(x.id)} data-gift-deal-sub={x.id}
          onToggle={(e) => { const now = (e.currentTarget as HTMLDetailsElement).open; if (now !== isOpen(x.id)) setOpen((o) => ({ ...o, [x.id]: now })); }}>
          <summary>
            <h2 className="gg-deal-sec-title" id={`gg-deal-sec-${x.id}-title`}>{x.title}</h2>
            {x.count !== null && <span className="gg-sec-count" data-gift-deal-sub-count="">{x.count}</span>}
          </summary>
          {x.body}
        </details>
      ))}
    </div>
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
      <style>{DEALS_CSS + CARD_CSS}</style>
      {/* Owner 2026-11-21 ("remove this"): no intro, "#ad" or helper line here, and no day line under the banner
          ("Fri, Nov 27. Plenty of these sales are on already"); each card says when it starts and ends. The footer's
          affiliate disclosure stays. */}
      {kind === "deals" ? (
        <DealSections
          day={codesDay(day, today)}
          deals={
            deals === null && failed ? (
              <GiftGuideLoadError message={G.dealsFailed} onRetry={retry} />
            ) : deals === null ? (
              <p className="gg-deal-meta" role="status">{W.loading}</p>
            ) : list.length === 0 ? null : (
              <ul className="gg-deal-grid" aria-labelledby="gg-deal-sec-deals-title" data-gift-deal-list={day.id}>
                {list.map((d) => <DealCard key={`${d.brand} ${d.href}`} deal={d} today={today} />)}
              </ul>
            )
          }
          dealCount={deals === null ? null : list.length}
          shownCodes={new Set(list.flatMap((d) => dealCode(d, today, STORE_CODES) ?? []).map((c) => c.toUpperCase()))}
        />
      ) : (
        <div className="gg-deals-list">
          {/* Owner 2026-11-21 ("add this to the top or bottom of the shop small business"): a one-line link at the top,
              the full "Get your business featured" card (the same admin-reviewed sign-up as /shop-small) at the bottom. */}
          <FeatureCtaLink />
          <SmallBizGrid />
          {/* No "more on Shop Small" link: /shop-small now opens this page (guides lane 11-21). */}
          <LazyLocalListings />
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
