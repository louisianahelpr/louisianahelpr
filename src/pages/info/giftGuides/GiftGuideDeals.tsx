import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BUNDLED_CODES_FILE, giftGuides as G, type DiscountCodesFile } from "@/content/giftGuides";
import { DEALS_COVER, DEALS_SLUG, DEALS_TINT, DEALS_WORDS as W, codesDay, dealCode, dealName, dealEnds, dealsFeatured, dealsIn, dealsTitle, eventOrder, eventPhase, isSteal, liveDeals, louisianaDay, stealSections, type Deal, type DealEvent } from "@/content/giftGuideDeals.mjs";
import { GiftOut } from "./GiftOut";
import { START_OPEN } from "./startOpen";
import { GuideSectionHead } from "./GuideSectionHead";
import { loadModule, untilReload } from "@/lib/loadModule";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { onAnyList, requestSaveFor } from "./saveForPeople";
import { usePlan } from "./fun/plannerStore";
import { CARD_CSS, CARD_WORDS, CodeCards, CodeChip, codeCardCount, SaleCards, codesOn, salesOn } from "./GiftGuideDealCards";
import { STORE_CODES, dealDayParts, setStoreCodes } from "@/content/giftGuideDealCounts";
import { SmallBizGrid } from "./GiftGuideSmallBiz";
import { FeatureCta, FeatureCtaLink } from "./SmallBizFeatureCta";
import { GiftGuideSort, MyListIcon, type SortChoice } from "./GiftGuideShare";
import { SBS_WORDS as SBS } from "@/content/sbsFeaturedLocal";
import type { SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { report } from "@/lib/errorLogger";
import { isLiveCodes, isLiveDeals, liveCopy, onLiveUpdate } from "@/lib/liveGuideData";
import { GiftGuideLoadError } from "./GiftGuideLoadError";
import { LazyGuideQa } from "./LazyGuideQa";
import { SamsBlackFridayFeature } from "./SamsClubParts";

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
.gg-deal{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:12px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink)}
.gg-deal-photo{display:flex;align-items:center;justify-content:center;height:120px;flex:none;border-radius:10px;background:#fff;overflow:hidden;isolation:isolate;text-decoration:none}
.gg-deal-photo img{width:100%;height:100%;object-fit:contain;padding:8px;mix-blend-mode:multiply}
.gg-deal-photo b{font-size:15px;color:var(--gg-muted);padding:8px;text-align:center}
.gg-deal-brand{margin:2px 0 0;font-size:15px;font-weight:700;color:var(--gg-ink);overflow-wrap:anywhere}
/* Polish audit 1127 #17: the brand link keeps its 44px tap height (.gg-card-store) but overlaps the 6px gaps around it,
   so the card reads photo, brand, offer, date with no tall empty band under the photo. */
.gg-deal>.gg-card-store,.gg-deal>.gg-card-head{margin-block:-6px}
.gg-deal-text{margin:0;font-size:14px;line-height:1.35;color:var(--gg-ink);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.gg-deal-meta{margin:0;font-size:12px;color:var(--gg-muted)}
.gg-deal>p[data-gift-deal-dates]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Polish audit 1127 #17: one compact deal card (~230px on a phone, was ~375px): 12px padding, a 120px photo, the brand
   15px/700, the offer 14px/1.35 clamped to 3 lines, the end date one 12px grey line. */
@media (max-width:767px){.gg:has([data-gift-deals-page]) .gg-banner h1{-webkit-line-clamp:3;font-size:clamp(25px,8vw,34px);line-height:1.05}}
.gg-deals-list{margin-top:12px}
.gg-deal-sec{scroll-margin-top:84px}
@media (max-width:767px){.gg-deal-sec{scroll-margin-top:132px}}
.gg-sec-toggle-h+.gg-deal-sec-body{margin-top:12px}
.gg-deals-small{display:inline-block;margin:16px 0 4px}
.gg-deals-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-deals-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-deals-feature b{display:block;font-size:16px}
.gg-deals-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-deals-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
.gg-sbs-row{display:flex;align-items:center;gap:4px;min-height:44px;margin:0 0 6px}
.gg-sbs-row .gg-sbs-toplink{flex:1 1 auto;min-width:0;margin:0}
.gg-sbs-row-icons{display:flex;align-items:center;flex:none;margin-left:auto}
@media (max-width:767px){.gg-sbs-row .gg-sbs-toplink{font-size:12px;line-height:1.35}}
@media (min-width:768px){.gg-sbs-row .gg-mylist-icon{display:none}}
`;


/** The deals file, loaded alone (the read runs after it, outside Vite's preload wrapper: dynamicImportThenDoesNoWork). */
// loadModule: a prevented preload (a recovery reload in flight) gives null, and the page keeps "Loading deals…".
const loadDeals = () => loadModule(() => import("@/content/giftGuideDeals.json"));

/*
 * STORE_CODES (giftGuideDealCounts.ts): every store code we list, with its expiry (the codes box's own list): a deal
 * card's code and its end day follow it (holiday audit 1121, High: XTRATUF's card kept the code XT25 after the box had
 * dropped it on Nov 30). One list with the menu's counts, so a live copy of the codes reaches both.
 */

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

/** One grid of deal cards (a store sale or a steal each), in the list's order. */
function DealGrid({ list, today, labelledBy, data }: { list: Deal[]; today: string; labelledBy: string; data: Record<string, string> }) {
  return (
    <ul className="gg-deal-grid" aria-labelledby={labelledBy} {...data}>
      {list.map((d) => <DealCard key={`${d.brand} ${d.item ?? ""} ${d.href}`} deal={d} today={today} />)}
    </ul>
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
 * guide section: the same shaded header band as Her's price sections (GuideSectionHead, owner 2026-11-22) with its
 * count, open on arrival (START_OPEN) and closed or opened again by its chevron. `dealCount` null = the deal cards are
 * still loading (or failed): that subsection shows the loading line or the Try again in its place, with no count yet.
 */
function DealSections({ day, today, deals, dealCount, steals, shownCodes }: { day: string; today: string; deals: ReactNode; dealCount: number | null; steals: { id: string; title: string; count: number; body: ReactNode }[]; shownCodes: ReadonlySet<string> }) {
  // Polish audit 1122 #12: a code a Top deal card already shows (XTRATUF's XT25) gets no second card under Discount codes.
  // `today` is the page's day (its `now`), so an embargoed code's `starts` reads the same clock as the rest of the page.
  const codes = codesOn(day, today).filter((c) => !shownCodes.has(c.code.toUpperCase()));
  const sales = salesOn(day);
  const sections = [
    ...(dealCount !== 0 ? [{ id: "deals", title: CARD_WORDS.dealsTitle, count: dealCount, body: deals }] : []),
    // The steals, one section per category (owner pop-up 11-24: "Toys & Kids (22)"), open like every section.
    ...steals.map((s) => ({ id: `steals-${s.id}`, title: s.title, count: s.count as number | null, body: s.body })),
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
      {/* Owner 2026-11-22 ("top deals, sales, and discount codes need to have the same layout and design as the collapse
          and expand sections on the his and hers guides. same for cyber monday"): each subsection is a guide section, its
          header the same shaded band as Her's price sections (GuideSectionHead, in the page's red), title, count and
          chevron; the body is drawn only while open, as on the guides. */}
      {sections.map((x) => (
        <section key={x.id} id={`gg-deal-sec-${x.id}`} className="gg-sec gg-deal-sec" aria-labelledby={`gg-deal-sec-${x.id}-title`} data-gift-deal-sub={x.id}>
          <GuideSectionHead titleId={`gg-deal-sec-${x.id}-title`} bodyId={`gg-deal-sec-${x.id}-list`} title={x.title} count={x.count} tint={DEALS_TINT}
            open={isOpen(x.id)} onToggle={() => setOpen((o) => ({ ...o, [x.id]: !isOpen(x.id) }))} data={{ "data-gift-deal-toggle": x.id }} />
          {isOpen(x.id) && <div className="gg-deal-sec-body" id={`gg-deal-sec-${x.id}-list`}>{x.body}</div>}
        </section>
      ))}
    </div>
  );
}

/**
 * The Small Business Saturday sort (owner 2026-11-22, iPhone: "Let them filter z-a and a-z move the heart and filter
 * on the same line as own a business"): the list's own order (by category) first, then A to Z and Z to A by name.
 */
type BizOrder = "category" | "az" | "za";
const BIZ_ORDERS: SortChoice<BizOrder>[] = [{ value: "category", label: SBS.sortCategory }, { value: "az", label: SBS.sortAz }, { value: "za", label: SBS.sortZa }];
const byName = (order: BizOrder) => (rows: SmallBiz[]) =>
  [...rows].sort((a, b) => (order === "za" ? -1 : 1) * a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

/** One deals day's page. `now` is for tests; the page passes nothing and reads the clock. */
export function GiftGuideDeals({ day, now }: { day: DealEvent; now?: Date }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  // Live data (owner 2026-11-23): the codes too. The bundled codes (or a newer saved copy) draw now; a newer valid copy
  // from the live site replaces them when it arrives, and the page draws again with it (src/lib/liveGuideData.ts).
  const [, setCodesCopy] = useState(0);
  useEffect(() => {
    const swap = (f: DiscountCodesFile) => {
      setStoreCodes(f.codes);
      setCodesCopy((n) => n + 1);
    };
    const off = onLiveUpdate<DiscountCodesFile>("codes", swap);
    const now = liveCopy<DiscountCodesFile>("codes", BUNDLED_CODES_FILE, isLiveCodes);
    if (now !== BUNDLED_CODES_FILE) swap(now);
    return off;
  }, []);
  const [bizOrder, setBizOrder] = useState<BizOrder>("category");
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
    // Live data (owner 2026-11-23): the bundled cards (or a newer saved copy) draw now; a newer valid copy from the live
    // site replaces them when it arrives (src/lib/liveGuideData.ts).
    const off = onLiveUpdate<Deal[]>("deals", (d) => live && setDeals(d));
    void loadDeals().then(
      // null: the app's recovery reload took the failure; if no reload comes (untilReload rejects), say so too.
      (m) => (m ? live && setDeals(liveCopy("deals", m.default as Deal[], isLiveDeals)) : untilReload().catch(fail)),
      fail,
    );
    return () => {
      live = false;
      off();
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
  // Owner pop-up 11-24: the store sales on top ("Biggest store sales"), then the steals by category (stealSections).
  const stores = list.filter((d) => !isSteal(d));
  return (
    <div data-gift-deals-page="" data-gift-deal-day-page={day.id} data-gift-deal-phase={eventPhase(day, today)}>
      <style>{DEALS_CSS + CARD_CSS}</style>
      {/* Owner 2026-11-21 ("remove this"): no intro, "#ad" or helper line here, and no day line under the banner
          ("Fri, Nov 27. Plenty of these sales are on already"); each card says when it starts and ends. The footer's
          affiliate disclosure stays. */}
      {/* Owner 2026-11-25: the Sam's Club Black Friday deals guide opens from the top of the Black Friday page. */}
      {day.id === "black-friday" && <SamsBlackFridayFeature />}
      {kind === "deals" ? (
        <DealSections
          day={codesDay(day, today)}
          today={today}
          deals={
            deals === null && failed ? (
              <GiftGuideLoadError message={G.dealsFailed} onRetry={retry} />
            ) : deals === null ? (
              <p className="gg-deal-meta" role="status" data-gift-deals-loading="">{W.loading}</p>
            ) : stores.length === 0 ? null : (
              <DealGrid list={stores} today={today} labelledBy="gg-deal-sec-deals-title" data={{ "data-gift-deal-list": day.id }} />
            )
          }
          dealCount={deals === null ? null : stores.length}
          steals={deals === null ? [] : stealSections(list).map((s) => ({ id: s.id, title: s.title, count: s.deals.length, body: <DealGrid list={s.deals} today={today} labelledBy={`gg-deal-sec-steals-${s.id}-title`} data={{ "data-gift-steal-list": s.id }} /> }))}
          shownCodes={new Set(list.flatMap((d) => dealCode(d, today, STORE_CODES) ?? []).map((c) => c.toUpperCase()))}
        />
      ) : (
        <div className="gg-deals-list">
          {/* Owner 2026-11-21 ("add this to the top or bottom of the shop small business"): a one-line link at the top,
              the full "Get your business featured" card (the same admin-reviewed sign-up as /shop-small) at the bottom.
              Owner 2026-11-22 (iPhone): that link, in smaller words, shares one row with the sort (A to Z, Z to A) and
              the My Wish List heart; from 768px the head row already holds the heart, so this row shows only the sort. */}
          <div className="gg-sbs-row" data-gift-sbs-row="">
            <FeatureCtaLink />
            <span className="gg-sbs-row-icons">
              <GiftGuideSort order={bizOrder} onChange={setBizOrder} choices={BIZ_ORDERS} label={SBS.sortLabel} activeLabel={SBS.sortLabelActive} />
              <MyListIcon />
            </span>
          </div>
          <SmallBizGrid arrange={bizOrder === "category" ? undefined : byName(bizOrder)} />
          {/* No "more on Shop Small" link: /shop-small now opens this page (guides lane 11-21). */}
          <LazyLocalListings />
          <LazyGuideQa kind="small-biz" page={day.id} />
        </div>
      )}
      {/* Owner pop-up 11-22 9:40 PM: common questions answered from this day's cards, its Updated day and who picks. */}
      {kind === "deals" && deals !== null && <LazyGuideQa kind="deals" page={day.id} deals={deals} listed={{ ...dealDayParts(day.id, deals, today), storeCodes: STORE_CODES }} />}
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
