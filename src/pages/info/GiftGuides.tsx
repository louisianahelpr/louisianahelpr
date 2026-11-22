import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { giftGuides as G } from "@/content/giftGuides";
import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import BackButton from "@/components/BackButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { guideBySlug, guidePicksVersion, loadGuidePicks, newSlugFor, picksReady, subscribeGuidePicks, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { GIFT_WISH_CSS } from "./giftGuides/giftWishStyles";
import { GiftGuidesWords } from "./giftGuides/GiftGuideCover";
import { GiftGuideLanding, finderAsked } from "./giftGuides/GiftGuideLanding";
import { GiftGuideMyList } from "./giftGuides/GiftGuideMyList";
import { useWishListSync } from "./giftGuides/wishListSync";
import { FirstHeartHint } from "./giftGuides/GiftGuideHints";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { WISH } from "@/content/giftWishList";
import { MY_LIST_SLUG } from "./giftGuides/giftList";
import { GiftGuideTools } from "./giftGuides/GiftGuideShare";
import type { GuideOrder } from "@/content/giftGuideEarnOrder";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import { shippingLine } from "@/content/giftGuideShipping";
import { GiftGuideView } from "./giftGuides/GiftGuideView";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { GiftGuidesSidebar } from "./giftGuides/GiftGuidesSidebar";
import { GiftGuidesPhoneNav } from "./giftGuides/GiftGuidesPhoneNav";
import { DEALS_COVER, GiftGuideDeals } from "./giftGuides/GiftGuideDeals";
import { DEALS_SLUG, dealDay, oldDealsTarget } from "@/content/giftGuideDeals.mjs";
import { OLD_PEOPLE_ANCHORS } from "@/content/giftGuidePeople.mjs";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";

/**
 * /gift-guides and /gift-guides/<slug> (owner 2026-11-16, public 2026-11-18; rebuilt 2026-11-18 to the owner's final
 * design): the page opens to the guides (a collapsible sidebar of every guide by group, and one sideways row of cover
 * tiles per group), and a tile opens that guide (a gingham band with its arch card, then its numbered list) or, for a
 * hub like For Kids, its child guides' tiles. Every word, pick and link comes from src/content/giftGuides.ts and
 * src/content/giftGuidesAmazon.ts (gathered in src/content/giftGuideCatalog.ts). Every outbound link is an affiliate
 * link (GiftOut). The FTC disclosure (16 CFR Part 255) and Amazon's required Associates statement sit at the BOTTOM
 * as plain muted lines (owner decision 2026-11-18). Guard: src/test/giftGuidesPage.test.tsx.
 */
/**
 * Speed 11-20: a cold /gift-guides/<slug> starts its guide's picks chunk as soon as this module runs (it is started
 * beside the app, src/boot/pathPageRoute.ts), not from GiftGuideView's effect after React has rendered the page. On
 * prod (Slow 4G + 4x, 375, guest) the list drew at 8.1 s. Elsewhere (a prefetch from another page) it does nothing.
 */
const coldSlug = typeof window === "undefined" ? undefined : /^\/gift-guides\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
if (coldSlug && guideBySlug(coldSlug)) {
  loadGuidePicks(coldSlug).catch((e: unknown) => {
    // GiftGuideView asks again on mount and owns the failure (its loading line stays).
    console.warn("gift guides: early picks load failed", coldSlug, e);
  });
}

/** The guide's head: its picks' first three names and their count (unique links, as src/prerender/seoData.ts counts). */
function guideHead(guide: CatalogGuide) {
  const seen = new Set<string>();
  const picks = guide.picks.filter((p) => p.name && p.href && !seen.has(p.href) && seen.add(p.href));
  return giftGuidePageMeta(guide.slug, guide.title, picks.slice(0, 3).map((p) => p.name), picks.length);
}

/**
 * The save-for-someone picker and My lists pill (owner 2026-11-21) load once the page has drawn, never on its
 * critical path: with the dialog, the input and the planner store they put /gift-guides/<slug> at 372 KB gz against
 * a 336 KB budget (train 1121f build). Until the chunk is in, a heart saves to My Wish List as before
 * (requestSaveFor is false with no picker mounted). Its CSS ships in the same chunk.
 */
type SaveForModule = { SaveForSomeone: ComponentType; SAVE_FOR_CSS: string };
const loadSaveFor = () => loadModule(() => import("./giftGuides/SaveForSomeone"));
function LazySaveForSomeone() {
  const [mod, setMod] = useState<SaveForModule | null>(null);
  useEffect(() => {
    let live = true;
    // An empty module (a stale-chunk reload on its way) waits on untilReload(); the hearts save to My Wish List meanwhile.
    void loadSaveFor()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setMod(m); },
        (e) => report(e as Error, { tags: { source: "GiftGuides.loadSaveFor" } }),
      );
    return () => {
      live = false;
    };
  }, []);
  if (!mod) return null;
  const { SaveForSomeone, SAVE_FOR_CSS } = mod;
  return (
    <>
      <style data-savefor-ready="">{SAVE_FOR_CSS}</style>
      <SaveForSomeone />
    </>
  );
}

/** "gifts for Her" -> "Gifts for Her". */
const capitalFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A shared list (/gift-guides/list/<code>) loads its own chunk (train 1121h): once Secret Santa's wish list imported
 * from it, it split out of this page's chunk and put /gift-guides/<slug> at 353 KB gz over its 352.8 KB budget, while
 * no guide page ever draws it. It says "Loading" until the chunk is in, the same line the list shows while it reads.
 */
type SharedListModule = { GiftGuideSharedList: ComponentType<{ code: string }> };
const loadSharedList = () => loadModule(() => import("./giftGuides/GiftGuideSharedList"));
function LazySharedList({ code }: { code: string }) {
  const [mod, setMod] = useState<SharedListModule | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    // An empty module (a stale-chunk reload on its way) waits on untilReload(); the loading line stays meanwhile.
    void loadSharedList()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setMod(m); },
        (e) => {
          // Not silent: reported, and the page says the list could not load.
          report(e as Error, { tags: { source: "GiftGuides.loadSharedList" } });
          if (live) setFailed(true);
        },
      );
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <p className="gg-soon" role="alert" data-gift-shared-failed="">{WISH.sharedFailed}</p>;
  if (!mod) return <p className="gg-soon" role="status">{WISH.loading}</p>;
  const { GiftGuideSharedList } = mod;
  return <GiftGuideSharedList code={code} />;
}

export default function GiftGuides() {
  const { slug: rawSlug, code } = useParams<{ slug?: string; code?: string }>();
  // My Wish List is /gift-guides/my-list (owner 2026-11-20); a shared list is /gift-guides/list/<code>.
  const myListPage = rawSlug === MY_LIST_SLUG;
  const slug = myListPage ? undefined : rawSlug;
  const shared = code !== undefined;
  // Signed in, the wish list is kept on the account too.
  useWishListSync();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const guide = guideBySlug(slug) ?? null;
  // Owner 11-21 (iPhone, Kids): "put the icons below the red banner. On the same line as the 81 gifts ... also move the
  // order by dec below the red banner". On a phone, a guide page draws the pill and the icons on the count's row under
  // its banner (countRow below), not on the row above it; the landing and every desktop keep them in the header row.
  const phone = useIsMobile();
  // Sort by price (owner 11-21: "add the filter button up with the search icons"): the header's menu sets the order of
  // an owner-list guide (Her, Him, Kids and their views); a new guide starts low to high.
  // Lead 11-21 (earn order): a new guide starts on "Recommended" (clicked picks first in each price section).
  const [order, setOrder] = useState<{ slug: string; order: GuideOrder }>({ slug: "", order: "top" });
  const sortOrder: GuideOrder = guide && order.slug === guide.slug ? order.order : "top";
  // Holiday audit 1121: no price sort over a list that shows no price (a list still loading keeps it, so it never jumps).
  const priced = guide ? guide.picks.length === 0 || guide.picks.some((p) => showsPrice(p)) : false;
  const sort = guide && isOwnerList(guide.slug) && priced ? { order: sortOrder, onChange: (o: GuideOrder) => setOrder({ slug: guide.slug, order: o }) } : undefined;
  // The deals days (owner 2026-11-21: "like each day has its own section, no need to put them all in 1"): Black Friday,
  // Small Business Saturday and Cyber Monday are each their own page (src/content/giftGuideDeals.mjs DEAL_EVENTS), not
  // a catalog list of picks. `deals` is the open day wherever the page only asks "is this a catalog guide?".
  const deals = slug && isLiveGuide(slug) ? dealDay(slug) : null;
  // SEO (follow-up 2026-11-18): the landing's head, or the open guide's own (one not in the sitemap is noindex).
  // SEO P1 (owner 11-19): its own description from its picks once they are in, as api/share.ts writes it before JS.
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion);
  usePageMeta(
    shared || myListPage ? { title: `${shared ? WISH.sharedLead : WISH.title} — Louisiana Helpr`, description: PUBLIC_PAGE_META["/gift-guides"].description, robots: "noindex" }
    : deals ? giftGuidePageMeta(deals.id) : guide ? guideHead(guide) : PUBLIC_PAGE_META["/gift-guides"],
  );
  const groupParam = params.get("group");
  const ship = shippingLine(new Date());
  // Visual check 11-18: at 375 the long pill squeezed "Gift guides" into "Gift / guid / es"; phones get the short words.
  const shipTail = " for Christmas delivery";
  const shipPill = ship ? (
    <p className="gg-ship whitespace-nowrap" data-gift-ship="">
      {ship.endsWith(shipTail) ? ship.slice(0, -shipTail.length) : ship}
      {ship.endsWith(shipTail) && <span className="hidden lg:inline">{shipTail}</span>}
    </p>
  ) : undefined;
  // The old My list address (?list=mine) opens My Wish List's own page.
  const oldMyList = !slug && !shared && !myListPage && params.get("list") === "mine";
  const myList = myListPage;
  const landing = !slug && !shared && !myListPage;

  // Pins link to /gift-guides#for-her, /gift-guides/for-her or a folded guide (/gift-guides/female-nurses): send each
  // old slug, folded guide or #<slug> to the guide's page now (newSlugFor).
  const hashSlug = decodeURIComponent(hash.replace(/^#/, ""));
  const fromHash = hashSlug ? newSlugFor(hashSlug) : null;
  if (oldMyList) return <Navigate to={`/gift-guides/${MY_LIST_SLUG}`} replace />;
  // Holiday audit 1121 #14: an old group link (/gift-guides?group=by-person, a pre-redesign "See all") opens the
  // landing itself; the group page (its own "All guides" link beside the header's back arrow, a green dot, small tiles)
  // is gone. With three live guides the landing's tiles are every group.
  if (landing && groupParam !== null) return <Navigate to={`/gift-guides${hash}`} replace />;
  // Holiday audit 1121: a slug typed in capitals (/gift-guides/HER) opens its guide, not the landing.
  if (rawSlug && rawSlug !== rawSlug.toLowerCase()) return <Navigate to={`/gift-guides/${rawSlug.toLowerCase()}${hash}`} replace />;
  // The old "Deals & codes" anchor on the landing: the codes live on the deals days now (Black Friday first).
  if (!slug && !shared && !myListPage && hash === "#gift-codes") return <Navigate to="/gift-guides/black-friday#gift-codes" replace />;
  if (!slug && !shared && !myListPage && fromHash) return <Navigate to={`/gift-guides/${fromHash}`} replace />;
  // For Her + For Him (owner 11-20): an old people section link (/gift-guides/her#wife, /gift-guides/mom#mother-in-law)
  // opens that relationship's page; a hash never reaches the server, so the page forwards it.
  const peopleTo = slug && hashSlug ? OLD_PEOPLE_ANCHORS[slug]?.[hashSlug] : undefined;
  if (peopleTo) return <Navigate to={`/gift-guides/${peopleTo}`} replace />;
  // The old one-page deals address (owner 11-21: each day its own page) opens Black Friday, or the day its #anchor names.
  if (slug === DEALS_SLUG) return <Navigate to={`/gift-guides/${oldDealsTarget(hash)}`} replace />;
  const moved = slug && !guide && !deals ? newSlugFor(slug) : null;
  if (moved) return <Navigate to={`/gift-guides/${moved}`} replace />;
  if (slug && !guide && !deals) return <Navigate to="/gift-guides" replace />;

  const footer = (
    <footer className="gg-disc">
      {/* Owner decision 2026-11-18 (~8:50 AM): the disclosures are plain muted lines at the BOTTOM, no box. The
          Amazon line is the exact statement the Amazon Associates Operating Agreement requires on a site with
          Amazon links. */}
      <p data-gift-disclosure="">{G.disclosure}</p>
      <p data-gift-amazon-statement="">{G.amazonStatement}</p>
      {/* Owner 11-18 PM: no "Every collection on ShopMy" / "Every gift guide on Pinterest" links; the disclosures stay. */}
    </footer>
  );

  // The search, My list heart and Share for this page (one set, on the row under the header).
  const tools = deals ? <GiftGuideTools path={`/gift-guides/${deals.id}`} title={deals.pageTitle} image={deals.kind === "deals" ? DEALS_COVER : undefined} />
    // Holiday audit 1121: shared text opens with a capital ("Gifts for Her", not "gifts for Her https://...").
    : guide ? <GiftGuideTools path={`/gift-guides/${guide.slug}`} title={capitalFirst(`${guide.lead} ${guide.title}`)} image={guide.cover} sort={sort} />
    : <GiftGuideTools path="/gift-guides" title={G.title} many myList={myList} />;
  // A guide or deals page keeps its banner (its own h1); every other page's h1 is the header title.
  const banner = Boolean(deals || guide);
  // The open menu entry beyond the guides: the deals page, or the finder view on the landing.
  const sidePage = deals ? deals.id : landing && finderAsked(params.toString() ? `?${params.toString()}` : "", hash) ? "finder" : undefined;
  // A phone's guide page: the count, the pill and the icons on one row right under the banner.
  const countRow = phone && Boolean(guide) && !deals;
  // The landing's arrow goes home; every other page's to the landing.
  const backTo = guide || deals || myList || shared ? "/gift-guides" : "/";

  return (
    // Owner 2026-11-21 ~12:30 PM ("holiday gift guides needs the same set up as the other pages. title on left with back
    // arrow on the left of the title"; then "add holiday to gift guides where it is by the back arrow. remove the
    // repeated title below. then move the 3 icons to the right of order by dec 15 etc"): EVERY gift guides page, the
    // landing too, opens with the shared header row (back arrow + "Holiday gift guides", left), and under it ONE row:
    // the shipping pill on the left, search + My list heart + Share on the right (wrapping on a phone). The centered
    // "top-rated finds / Holiday Gift Guides" title block is gone. The landing's arrow goes home; every other page's to
    // the landing.
    // Owner 11-21 (later): "all of this should be on the same row": from 768px up the back arrow + title, the pill and
    // search + heart + share are ONE row (the page draws it, so the shell's own header row is off); a phone wraps it to
    // two rows (arrow + title, then the pill and the icons).
    <PublicHeaderPage title={G.headerTitle} titleTag={banner ? "p" : "h1"} backTo={backTo} hideHeader bottomPaddingClassName="pb-12 md:pb-16">
      <style>{GIFT_GUIDES_CSS + GIFT_WISH_CSS}</style>
      {/* The first heart's one-time "Saved to your wish list" note (owner 2026-11-20 hints), on every gift guides page. */}
      <FirstHeartHint />
      {/* Owner 2026-11-21: a guide's hearts save for someone (the picker) and the My lists pill, on guide and deals pages. */}
      {(guide || deals?.kind === "deals") && <LazySaveForSomeone />}
      {/* The full public container (78rem), never a narrower page column (owner 2026-11-18: "fill the screen"). */}
      <div className="gg w-full" data-gift-guides="">
        {/* Owner's mockup (2026-11-18): the way back and the header words run across the top, above the menu and the guides. */}
        {/* Owner 2026-11-18 PM: the shipping pill sits on the page header's own row ("← Gift guides"), right-aligned
            (titleActions above), so no row of its own sits above the hero. A guide page has no second "← All guides"
            link ("double back button?? does the same thing"): the header's back arrow goes to /gift-guides. */}
        {/* Owner redesign 11-18 PM: under the title ONE slim row (search, My list, Share); Text and Copy link sit in
            Share's menu and the codes are a "Deals & codes" section of the page. The banner title is the page's h1
            (live audit r3 #7); the header's "Gift guides" is a plain line (titleTag="p"). */}
        <div className={shipPill ? "gg-headrow" : "gg-headrow gg-headrow-noship"} data-gift-headrow="">
          <div className="gg-head-title" data-gift-head-title="">
            <span className="contents" data-gift-back-to={backTo}><BackButton to={backTo} /></span>
            {banner ? <p className="text-page-title leading-tight" data-gift-head-name="">{G.headerTitle}</p> : <h1 className="text-page-title leading-tight" data-gift-head-name="">{G.headerTitle}</h1>}
          </div>
          {!countRow && shipPill}
          {!countRow && tools}
        </div>
        {/* Owner 11-21 ("We need a way to organize this on the phones"): up to 767px a sticky chip row and a menu sheet
            replace the sidebar (which a phone no longer draws at the page's foot). */}
        <GiftGuidesPhoneNav active={guide} myList={myList || shared} page={sidePage} />
        {deals ? (
          <GiftGuidesWords lead={deals.lead} title={deals.pageTitle} titleId="gift-guide-title" tint={deals.kind === "small-biz" ? "green" : "red"} tools={null} />
        ) : guide ? (
          <GiftGuidesWords lead={guide.age ? `${guide.lead}, ${guide.age}` : guide.lead} title={guide.title} titleId="gift-guide-title" tint={guide.tint} tools={null} />
        ) : null}
        {countRow && guide && (
          <div className="gg-countrow" data-gift-countrow="">
            <div className="gg-countrow-left">
              {picksReady(guide.slug) && guide.picks.length > 0 && <p className="gg-itemcount" data-gift-item-count="">{G.itemCount(guide.picks.length)}</p>}
              {shipPill}
            </div>
            {tools}
          </div>
        )}
        {/* Owner 11-21 ("put like a line or something above all guides and under search bar all the way across to be a
            divider"): one hairline across the content width, under the search row and above the menu and the guides. */}
        {landing && <hr className="gg-divider" data-gift-divider="" />}
        {/* Holiday audit 1121 #22 / #27: the page comes first in the code (keyboard and screen readers met 16 menu links
            before the gifts), then the menu, then the disclosures, so a phone reads and shows them in that order, the
            disclosures at the very bottom. From 768px the CSS grid puts the menu on the left (GIFT_GUIDES_CSS). */}
        <div className="gg-layout">
          <div className="gg-main">
            {deals ? <GiftGuideDeals key={deals.id} day={deals} /> : guide ? <GiftGuideView guide={guide} order={sortOrder} hideCount={countRow} /> : shared ? <LazySharedList code={code} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding />}
          </div>
          {/* A shared list marks nothing current either (holiday audit 1121: it marked "All guides"). */}
          <GiftGuidesSidebar active={guide} myList={myList || shared} page={sidePage} />
          {footer}
        </div>
      </div>
    </PublicHeaderPage>
  );
}
