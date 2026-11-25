import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { giftGuides as G } from "@/content/giftGuides";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { STORES, guideBySlug, guidePicksVersion, loadGuidePicks, newSlugFor, picksReady, subscribeGuidePicks, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { GuidesMenuHint, MENU_HINT_GUIDES } from "./giftGuides/GiftGuideMenuHint";
import { GIFT_WISH_CSS } from "./giftGuides/giftWishStyles";
import { GuidesTop, type GuidesBanner } from "./giftGuides/GuidesTop";
import { GiftGuideLanding, finderAsked } from "./giftGuides/GiftGuideLanding";
import { useWishListSync } from "./giftGuides/wishListSync";
import { FirstHeartHint } from "./giftGuides/GiftGuideHints";
import { loadModule, untilReload } from "@/lib/loadModule";
import { whenPageSettled } from "@/lib/pageSettled";
import { report } from "@/lib/errorLogger";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { MY_LIST_SLUG } from "./giftGuides/giftList";
import { GiftGuideTools } from "./giftGuides/GiftGuideShare";
import type { GuideOrder } from "@/content/giftGuideEarnOrder";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import { BUDGETS, BUDGET_MIN_PICKS, GiftGuideView, sectionLabel, sectionNav } from "./giftGuides/GiftGuideView";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { GiftGuidesSidebar } from "./giftGuides/GiftGuidesSidebar";
import { GuidesDisclosure } from "./giftGuides/GuidesDisclosure";
import { DEALS_COVER, DEALS_SLUG, DEALS_TINT, DEALS_WORDS, dealDay, oldDealsTarget } from "@/content/giftGuideDeals.mjs";
import { OLD_PEOPLE_ANCHORS } from "@/content/giftGuidePeople.mjs";
import { isLiveGuide, isThemeGuide } from "@/content/giftGuideLive.mjs";
import { KIDS_FILTER_GUIDE, KID_AGES, KID_GENDERS, KID_PRICES, NO_KIDS_SELECTION, filterKids, kidsGenderCounts, loadKidTags, toggleIn, type KidAge, type KidGender, type KidPrice, type KidTags, type KidsSelection } from "@/content/giftGuideKidsFilter";
import { louisianaToday } from "@/content/giftGuideExtras1120";
import { searchPageGuides } from "@/content/guideSearchIndex.mjs";

/**
 * /gift-guides and /gift-guides/<slug> (owner 2026-11-16, public 2026-11-18; rebuilt 2026-11-18 to the owner's final
 * design): the page opens to the guides (a collapsible sidebar of every guide by group, and one sideways row of cover
 * tiles per group), and a tile opens that guide (a gingham band with its arch card, then its numbered list) or, for a
 * hub like For Kids, its child guides' tiles. Every word, pick and link comes from src/content/giftGuides.ts and the
 * researched picks, gathered in src/content/giftGuideCatalog.ts (the retired Amazon guides are not read). Every
 * outbound link is an affiliate link (GiftOut). The FTC disclosure (16 CFR Part 255) and Amazon's required Associates
 * statement sit at the BOTTOM as plain muted lines (owner decision 2026-11-18). Guard: src/test/giftGuidesPage.test.tsx.
 */
/**
 * Speed 11-20: a cold /gift-guides/<slug> starts its guide's picks chunk as soon as this module runs (it is started
 * beside the app, src/boot/pathPageRoute.ts), not from GiftGuideView's effect after React has rendered the page. On
 * prod (Slow 4G + 4x, 375, guest) the list drew at 8.1 s. Elsewhere (a prefetch from another page) it does nothing.
 */
const coldSlug = typeof window === "undefined" ? undefined : /^\/gift-guides\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
if (coldSlug && (guideBySlug(coldSlug) || searchPageGuides(coldSlug))) {
  loadGuidePicks(coldSlug).catch((e: unknown) => {
    // GiftGuideView asks again on mount and owns the failure (its loading line stays).
    console.warn("gift guides: early picks load failed", coldSlug, e);
  });
}

/**
 * The guide's head: its picks' first three names and their count (unique links, as src/prerender/seoData.ts counts).
 * A themed kids guide's head is built from all its picks (owner 11-25, search): their prices and stores, as the pre-JS
 * head is (api/share.ts giftGuideHead, from the same catalog picks).
 */
function guideHead(guide: CatalogGuide) {
  const seen = new Set<string>();
  const picks = guide.picks.filter((p) => p.name && p.href && !seen.has(p.href) && seen.add(p.href));
  const themePicks = isThemeGuide(guide.slug)
    ? picks.map((p) => ({ name: p.name, price: p.price, priceAt: p.priceAt, priceFrom: p.priceFrom, store: STORES[p.store]?.name ?? "" }))
    : null;
  return giftGuidePageMeta(guide.slug, guide.title, picks.slice(0, 3).map((p) => p.name), picks.length, themePicks);
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
    // Guide speed 1124 (speed-1122n S1/S8): only once the page has settled (whenPageSettled: loaded, then 1 s with no
    // download). Started at the first render, this chunk's preload list (~150 KB: the dialog, the planner store,
    // signed-in-deep) shared the phone's link with the guide's own picks chunk, and the list drew at 7.0 s (local build,
    // Slow 4G + 4x, 375; her.json took 2.2-2.4 s to arrive instead of 0.8 s).
    // An empty module (a stale-chunk reload on its way) waits on untilReload(); the hearts save to My Wish List meanwhile.
    const stop = whenPageSettled(() => {
      void loadSaveFor()
        .then((m) => m ?? untilReload())
        .then(
          (m) => { if (live) setMod(m); },
          (e) => report(e as Error, { tags: { source: "GiftGuides.loadSaveFor" } }),
        );
    });
    return () => {
      live = false;
      stop();
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

/**
 * A phone-width window (under 768px, useIsMobile's line), known on the FIRST render. useIsMobile starts false and
 * flips in an effect after the first paint, so a phone painted every guide page once without its count row ("159
 * gifts", the pill and the icons) and then pushed the gifts 54px down (owner 2026-11-24 ~7 PM, the Kids page: "It
 * shouldn't move like this"; layout shift 0.0255 at 375, measured on a local build). Guard:
 * src/test/giftGuideKidsThemeRow1124.test.tsx.
 */
const PHONE_QUERY = "(max-width: 767px)";
const phoneNow = () => window.innerWidth < 768;
const onPhoneChange = (fire: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", fire);
  return () => mql.removeEventListener("change", fire);
};
const usePhoneWidth = () => useSyncExternalStore(onPhoneChange, phoneNow, phoneNow);

/** "gifts for Her" -> "Gifts for Her". */
const capitalFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A part no guide page draws loads its own chunk, saying "Loading" until it is in (or that it could not load):
 * a shared list (/gift-guides/list/<code>; train 1121h: once Secret Santa's wish list imported from it, it put
 * /gift-guides/<slug> at 353 KB gz over its 352.8 KB budget) and My Wish List (/gift-guides/my-list; train 1121i: its
 * delete, save status and photo rows put the guide pages at 359 KB gz).
 */
function useLazyPart<M>(load: () => Promise<M | null>, source: string): M | "failed" | null {
  const [mod, setMod] = useState<M | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    // An empty module (a stale-chunk reload on its way) waits on untilReload(); the loading line stays meanwhile.
    void load()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setMod(m); },
        (e) => {
          // Not silent: reported, and the page says the list could not load.
          report(e as Error, { tags: { source } });
          if (live) setMod("failed");
        },
      );
    return () => {
      live = false;
    };
  }, [load, source]);
  return mod;
}
const loadSharedList = () => loadModule(() => import("./giftGuides/GiftGuideSharedList"));
const loadMyList = () => loadModule(() => import("./giftGuides/GiftGuideMyList"));
function LazySharedList({ code }: { code: string }) {
  const mod = useLazyPart(loadSharedList, "GiftGuides.loadSharedList");
  if (mod === "failed") return <p className="gg-soon" role="alert" data-gift-shared-failed="">{WISH.sharedFailed}</p>;
  if (!mod) return <p className="gg-soon" role="status">{WISH.loading}</p>;
  return <mod.GiftGuideSharedList code={code} />;
}
/**
 * The deals day pages (Black Friday, Small Business Saturday, Cyber Monday) load their own chunk too (train 1121i: the
 * codes and sales lists, the offer-copy cleaning and the Small Business grid put every guide page at 353 KB gz over its
 * 352.8 KB budget). A failed load says so, like the lists above.
 */
const loadDeals = () => loadModule(() => import("./giftGuides/GiftGuideDeals"));
// Guide speed 1124 (speed-1122n S5): a cold deals day page starts its deals chunk as this module runs, not from
// LazyDeals' effect after the first render (the deals file itself starts beside the app, src/boot/pathPageRoute.ts).
// The import is memoised by the browser, so LazyDeals' own loadDeals() gets the same module; it owns the failure.
if (coldSlug && dealDay(coldSlug)) {
  loadDeals().catch(() => {
    /* LazyDeals asks again on mount and owns the failure (its Try again line) */
  });
}
/**
 * The Kids page's row of themed guide covers (owner 2026-11-24) loads its own chunk once the page has drawn (the theme
 * train put /gift-guides/<slug> at 325 KB gz over its 321 KB critical-path allowance, Q178: the row's arrow icons and
 * button). Until it is in, an invisible stand-in of the same height holds its place (one cover-sized square in the same
 * row and tile CSS), so nothing below it moves; a failed load leaves the stand-in and is reported.
 */
const loadThemeRow = () => loadModule(() => import("./giftGuides/GiftGuideThemeRow"));
// A themed guide's Filter tags: the import alone in its loader, the read on its result (dynamicImportThenDoesNoWork).
const loadThemeTags = () => loadModule(() => import("@/content/giftGuideThemeTags"));
function LazyThemeRow() {
  const mod = useLazyPart(loadThemeRow, "GiftGuides.loadThemeRow");
  if (!mod || mod === "failed") {
    return (
      <div className="gg-themes" aria-hidden="true" data-gift-theme-row-wait="">
        <ul className="gg-row gg-themes-row invisible"><li><span className="gg-cover" /></li></ul>
      </div>
    );
  }
  return <mod.GiftGuideThemeRow />;
}
function LazyDeals({ day }: { day: NonNullable<ReturnType<typeof dealDay>> }) {
  const mod = useLazyPart(loadDeals, "GiftGuides.loadDeals");
  if (mod === "failed") return <p className="gg-soon" role="alert" data-gift-deals-failed="">{G.dealsLoadFailed}</p>;
  // Guide speed 1124 (speed-1122n S5): it said "Loading your list…" (the wish list's words) and then the page's own
  // "Loading deals…"; now it says the page's words from the start.
  if (!mod) return <p className="gg-soon" role="status" data-gift-deals-loading="">{DEALS_WORDS.loading}</p>;
  return <mod.GiftGuideDeals day={day} />;
}
/**
 * Search pages (owner 2026-11-23, "add a lot of different searches"): their words, matcher and the guides' "Popular
 * searches" line load in their own chunk (src/pages/info/giftGuides/GuideSearchLinks.tsx), never on a guide page's
 * first paint (the /gift-guides/<slug> critical-path budget, Q178). Only the slug map (guideSearchIndex.mjs) is here.
 */
type SearchModule = typeof import("./giftGuides/GuideSearchLinks");
const loadSearch = () => loadModule(() => import("./giftGuides/GuideSearchLinks"));
function useSearchModule(wanted: boolean): SearchModule | "failed" | null {
  const [mod, setMod] = useState<SearchModule | "failed" | null>(null);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    void loadSearch()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setMod(m); },
        (e) => {
          report(e as Error, { tags: { source: "GiftGuides.loadSearch" } });
          if (live) setMod("failed");
        },
      );
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

function LazyMyList() {
  const mod = useLazyPart(loadMyList, "GiftGuides.loadMyList");
  if (mod === "failed") return <p className="gg-soon" role="alert" data-gift-mylist-failed="">{WISH.sharedFailed}</p>;
  if (!mod) return <p className="gg-soon" role="status">{WISH.loading}</p>;
  return <mod.GiftGuideMyList />;
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
  // Search pages (owner 11-23, guideSearchPages.mjs): a filtered view of Her, Him or Kids, drawn once its chunk is in; an
  // age page waits for the Kids tags too. A main guide loads the same chunk for its "Popular searches" line.
  const searchSlug = searchPageGuides(slug) ? slug : undefined;
  const searchMod = useSearchModule(Boolean(searchSlug || guideBySlug(slug)));
  const sm = searchMod && searchMod !== "failed" ? searchMod : null;
  const search = sm && searchSlug ? sm.searchPageBySlug(searchSlug) : null;
  // The Kids tag file, or a theme's own tags (owner 11-24 ~7 PM; giftGuideThemeTags.ts, loaded on its page only), by page.
  const [tagsAt, setTagsAt] = useState<{ key: string; tags: KidTags } | null>(null);
  const tagsKey = slug && isThemeGuide(slug) ? slug : "kids";
  const kidTags = tagsAt?.key === tagsKey ? tagsAt.tags : null;
  const guide = guideBySlug(slug) ?? (sm ? sm.searchGuide(searchSlug, kidTags) : null);
  // Owner 11-21 (iPhone, Kids): "put the icons below the red banner. On the same line as the 81 gifts ... also move the
  // order by dec below the red banner". On a phone, a guide page draws the pill and the icons on the count's row under
  // its banner (countRow below), not on the row above it; the landing and every desktop keep them in the header row.
  const phone = usePhoneWidth();
  // Sort by price (owner 11-21: "add the filter button up with the search icons"): the header's menu sets the order of
  // an owner-list guide (Her, Him, Kids and their views); a new guide starts low to high.
  // Lead 11-21 (earn order): a new guide starts on "Recommended" (clicked picks first in each price section).
  const [order, setOrder] = useState<{ slug: string; order: GuideOrder }>({ slug: "", order: "top" });
  const sortOrder: GuideOrder = guide && order.slug === guide.slug ? order.order : "top";
  // Holiday audit 1121: no price sort over a list that shows no price (a list still loading keeps it, so it never jumps).
  const priced = guide ? guide.picks.length === 0 || guide.picks.some((p) => showsPrice(p)) : false;
  // The themed kids guides (owner 11-24 ~7 PM: "add a filter like the main 3 guides. They should also be sorted like the
  // main 3 guides") are set up as Kids: the price sort, and Kids' Filter (its tags from the theme's own picks).
  const themePage = tagsKey !== "kids";
  const sort = guide && (isOwnerList(guide.slug) || themePage) && priced ? { order: sortOrder, onChange: (o: GuideOrder) => setOrder({ slug: guide.slug, order: o }) } : undefined;
  // Owner 2026-11-21, the 25 Days sponsors page: "move search, heart and share under the line for shop our sponsors,
  // and move those things into the filter for that section": its section links and price limits live in a Filter among
  // its icons (budget kept here). Owner 11-22: its pill and icons sit where Her's do (countRow below).
  const sponsorsPage = guide?.slug === "25-days-sponsors";
  const [sponsorBudget, setSponsorBudget] = useState<number | null>(null);
  // For Kids (owner pop-up 2026-11-23 ~10:55 AM: "Age + price + girls/boys"): multi-select Age, Price and For chips in
  // the guide's Filter (the same sliders icon, which on Kids also holds the sort), kept as the sort is kept: per guide,
  // for this visit (another guide starts with none on). The tag file loads on this page only (giftGuideKidsFilter.ts).
  const kidsPage = guide?.slug === KIDS_FILTER_GUIDE || themePage;
  const [kidsPick, setKidsPick] = useState<{ slug: string; sel: KidsSelection }>({ slug: "", sel: NO_KIDS_SELECTION });
  const kidsSel = guide && kidsPick.slug === guide.slug ? kidsPick.sel : NO_KIDS_SELECTION;
  const setKidsSel = (f: (s: KidsSelection) => KidsSelection) => {
    if (guide) setKidsPick((cur) => ({ slug: guide.slug, sel: f(cur.slug === guide.slug ? cur.sel : NO_KIDS_SELECTION) }));
  };
  const clearKids = () => setKidsSel(() => NO_KIDS_SELECTION);
  const needsTags = kidsPage || Boolean(sm && search && sm.searchNeedsTags(search));
  useEffect(() => {
    if (!needsTags || kidTags) return;
    let live = true;
    (tagsKey === "kids" ? loadKidTags() : loadThemeTags().then((m) => m ?? untilReload()).then((m) => m.themeTags(tagsKey))).then((t) => { if (live) setTagsAt({ key: tagsKey, tags: t }); }, (e: unknown) => {
      // Offline or a stale deploy: the Price chips still work; Age and For come back on the next visit.
      console.warn("gift guides: kids tags failed", e);
    });
    return () => { live = false; };
  }, [needsTags, kidTags, tagsKey]);
  const headerFilter = sponsorsPage ? { budget: sponsorBudget, onBudget: setSponsorBudget }
    : kidsPage ? { budget: null, onBudget: () => undefined, kids: { sel: kidsSel, tags: kidTags ?? {}, onClear: clearKids } }
    : undefined;
  const kidsTools = kidsPage && guide ? {
    sections: [],
    budgets: [],
    budget: null,
    onBudget: () => undefined,
    onJump: () => undefined,
    sort,
    groups: [
      // Age and For read the tag file; until it is in, only Price shows (never a chip that would empty the list).
      ...(kidTags ? [{ id: "age", label: G.kidsAgeLabel, choices: KID_AGES.map((a) => ({ value: a.id, label: a.label })), selected: kidsSel.ages,
        onToggle: (v: string) => setKidsSel((s) => ({ ...s, ages: toggleIn(s.ages, v as KidAge) })) }] : []),
      { id: "price", label: G.kidsPriceLabel, choices: KID_PRICES.map((p) => ({ value: p.id, label: p.label })), selected: kidsSel.prices,
        onToggle: (v: string) => setKidsSel((s) => ({ ...s, prices: toggleIn(s.prices, v as KidPrice) })) },
      // B5 (flow audit 11-23): each For chip names its count, so Girls showing every gift reads as true, not broken.
      ...(kidTags ? [{ id: "for", label: G.kidsForLabel, choices: ((n) => KID_GENDERS.map((g) => ({ value: g.id, label: `${g.label} (${n[g.id]})` })))(kidsGenderCounts(guide.picks, kidsSel, kidTags, louisianaToday(new Date()))), selected: kidsSel.genders,
        onToggle: (v: string) => setKidsSel((s) => ({ ...s, genders: toggleIn(s.genders, v as KidGender) })) }] : []),
    ],
    shown: { count: filterKids(guide.picks, kidsSel, kidTags ?? {}, louisianaToday(new Date())).length, total: guide.picks.length },
    onClear: clearKids,
  } : undefined;
  const sponsorSections = sponsorsPage && guide && picksReady(guide.slug) ? sectionNav(guide.picks).map((x) => ({ id: x.id, title: sectionLabel(guide, x.title, x.id) })) : [];
  const sponsorBudgets = sponsorsPage && guide && picksReady(guide.slug) && guide.picks.filter((p) => p.band !== undefined && showsPrice(p)).length >= BUDGET_MIN_PICKS ? [...BUDGETS] : [];
  const toolsFilter = kidsTools ?? (sponsorsPage ? {
    sections: sponsorSections,
    budgets: sponsorBudgets,
    budget: sponsorBudget,
    onBudget: setSponsorBudget,
    onJump: (id: string) => {
      setSponsorBudget(null);
      window.history.replaceState(window.history.state, "", `#${id}`);
      requestAnimationFrame(() => document.getElementById(`gg-sec-${id}`)?.scrollIntoView({ block: "start" }));
    },
  } : undefined);
  // The deals days (owner 2026-11-21: "like each day has its own section, no need to put them all in 1"): Black Friday,
  // Small Business Saturday and Cyber Monday are each their own page (src/content/giftGuideDeals.mjs DEAL_EVENTS), not
  // a catalog list of picks. `deals` is the open day wherever the page only asks "is this a catalog guide?".
  const deals = slug && isLiveGuide(slug) ? dealDay(slug) : null;
  // SEO (follow-up 2026-11-18): the landing's head, or the open guide's own (one not in the sitemap is noindex).
  // SEO P1 (owner 11-19): its own description from its picks once they are in, as api/share.ts writes it before JS.
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion);
  const page = useRef<HTMLDivElement>(null);
  usePageMeta(
    shared || myListPage ? { title: `${shared ? WISH.sharedLead : WISH.title} — Helpr`, description: PUBLIC_PAGE_META["/gift-guides"].description, robots: "noindex" }
    : deals ? giftGuidePageMeta(deals.id) : sm && search ? sm.searchPageMeta(search) : guide ? guideHead(guide) : PUBLIC_PAGE_META["/gift-guides"],
  );
  const groupParam = params.get("group");
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
  // Guides audit 1122 #27: the server sends the old address to Black Friday and the browser keeps its #cyber-monday, so a
  // deals-day page whose # names ANOTHER deals day sends the visitor to that day (the in-page anchors are not day names).
  const otherDay = deals && hashSlug && hashSlug !== deals.id ? dealDay(hashSlug) : null;
  if (otherDay) return <Navigate to={`/gift-guides/${otherDay.id}`} replace />;
  const moved = slug && !guide && !deals ? newSlugFor(slug) : null;
  if (moved) return <Navigate to={`/gift-guides/${moved}`} replace />;
  if (slug && !guide && !deals && !searchSlug) return <Navigate to="/gift-guides" replace />;

  // Owner decision 2026-11-18 (~8:50 AM): the disclosures are plain muted lines at the BOTTOM, no box; the Amazon line is
  // the exact statement the Amazon Associates Operating Agreement requires on a site with Amazon links. Owner 2026-11-22
  // ("Make this small on 1 line"): ONE small line. Owner 11-22 later: only on a page that shows an affiliate link
  // (GuidesDisclosure watches the page). Owner 11-18 PM: no "Every collection on ShopMy" / Pinterest links.
  const footer = <GuidesDisclosure scope={page} />;

  // The search, My list heart and Share for this page (one set, on the row under the header).
  const tools = deals ? <GiftGuideTools path={`/gift-guides/${deals.id}`} title={deals.pageTitle} image={deals.kind === "deals" ? DEALS_COVER : undefined} />
    // Holiday audit 1121: shared text opens with a capital ("Gifts for Her", not "gifts for Her https://...").
    : guide ? <GiftGuideTools path={`/gift-guides/${guide.slug}`} title={capitalFirst(`${guide.lead} ${guide.title}`)} image={guide.cover} sort={kidsTools ? undefined : sort} filter={toolsFilter} />
    : <GiftGuideTools path="/gift-guides" title={G.title} many myList={myList} />;
  // The open menu entry beyond the guides: the deals page, or the finder view on the landing.
  const sidePage = deals ? deals.id : landing && finderAsked(params.toString() ? `?${params.toString()}` : "", hash) ? "finder" : undefined;
  // Every page but the landing opens on its gingham banner (its own h1; owner 11-22 #13: the wish lists and Find a gift
  // too, as the guides and the deals days); the landing's h1 is the head row's title.
  const banner: GuidesBanner | null = deals ? { lead: deals.lead, title: deals.pageTitle, tint: deals.kind === "small-biz" ? "green" : DEALS_TINT, sub: false }
    : guide ? { lead: guide.age ? `${guide.lead}, ${guide.age}` : guide.lead, title: guide.title, tint: guide.tint, sub: false }
    : myList ? G.pageBanners.myList
    : shared ? G.pageBanners.shared
    : sidePage === "finder" ? G.pageBanners.finder
    : null;
  // A phone's guide page: the count, the pill and the icons on one row right under the banner.
  // Owner 2026-11-22 ("104 gifts needs to move to the right like the other pages are set up"): the 25 Days sponsors page
  // is set up as Her, Him and Kids, so on a desktop its pill and icons (its Filter among them) ride the header row and
  // its count heads the content column, and on a phone it has the guides' one row under the banner.
  const countRow = phone && Boolean(guide) && !deals;
  // The landing's arrow goes home; every other page's (Find a gift too, owner 11-22 #13) to the landing.
  const backTo = guide || deals || myList || shared || sidePage === "finder" ? "/gift-guides" : "/";

  return (
    // Owner 2026-11-21 ~12:30 PM ("holiday gift guides needs the same set up as the other pages. title on left with back
    // arrow on the left of the title"; then "add holiday to gift guides where it is by the back arrow. remove the
    // repeated title below. then move the 3 icons to the right of order by dec 15 etc"): EVERY gift guides page, the
    // landing too, opens with the shared header row (back arrow + "Holiday gift guides", left), and under it ONE row:
    // the shipping pill on the left, search + My list heart + Share on the right (wrapping on a phone). The centered
    // "top-rated finds / Holiday gift guides" title block is gone. The landing's arrow goes home; every other page's to
    // the landing.
    // Owner 11-21 (later): "all of this should be on the same row": from 768px up the back arrow + title, the pill and
    // search + heart + share are ONE row (the page draws it, so the shell's own header row is off); a phone wraps it to
    // two rows (arrow + title, then the pill and the icons).
    <PublicHeaderPage title={G.headerTitle} titleTag={banner ? "p" : "h1"} backTo={backTo} hideHeader bottomPaddingClassName="pb-12 md:pb-16">
      <style>{GIFT_GUIDES_CSS + GIFT_WISH_CSS + (sm ? sm.GUIDE_SEARCH_CSS : "")}</style>
      {/* The first heart's one-time "Saved to your wish list" note (owner 2026-11-20 hints), on every gift guides page. */}
      <FirstHeartHint />
      {/* Owner 2026-11-21: a guide's hearts save for someone (the picker) and the My lists pill, on guide and deals pages. */}
      {(guide || deals?.kind === "deals") && <LazySaveForSomeone />}
      {/* The full public container (78rem), never a narrower page column (owner 2026-11-18: "fill the screen"). */}
      <div className="gg w-full" data-gift-guides="" ref={page}>
        {/* Owner's mockup (2026-11-18): the way back and the header words run across the top, above the menu and the guides. */}
        {/* A guide page has no second "← All guides" link ("double back button?? does the same thing"): the header's back
            arrow goes to /gift-guides. Owner 2026-11-24 ~8:30 PM, "Remove by Dec 15 everywhere": no shipping pill. */}
        {/* Owner redesign 11-18 PM: under the title ONE slim row (search, My list, Share); Text and Copy link sit in
            Share's menu and the codes are a "Deals & codes" section of the page. The banner title is the page's h1
            (live audit r3 #7); the header's "Gift guides" is a plain line (titleTag="p"). */}
        {/* The one top of every guides page (GuidesTop): the head row, the banner. A phone's guide
            page and the 25 Days sponsors page put the icons on the count row under the banner. */}
        {/* Owner 11-22 (phone): the head row's heart and three-line menu replace the chip row on every page; a guide's
            own count row under its banner is kept as it is ("she didn't ask to change it"). */}
        <GuidesTop backTo={backTo} banner={banner} tools={tools} nav={{ active: guide, myList: myList || shared, page: sidePage }} toolsInRow={!countRow}
          below={(
            <>
              {/* Owner 2026-11-24 8:23 PM: on Kids the "Tap the menu" tip sits ABOVE the theme covers ("Move the tap box
                  above the new guides"); Her and Him keep it in the guide (GiftGuideView). */}
              {guide?.slug === KIDS_FILTER_GUIDE && MENU_HINT_GUIDES.has(guide.slug) && <GuidesMenuHint />}
              {/* Owner 2026-11-24: the themed kids guides' green covers, right under the red Kids banner. */}
              {guide?.slug === KIDS_FILTER_GUIDE && <LazyThemeRow />}
              {/* A phone's count row: the count on the left, the icons on the right (no shipping pill, owner 11-24). */}
              {countRow && guide && (
                <div className="gg-countrow" data-gift-countrow="">
                  <div className="gg-countrow-left">
                    {picksReady(guide.slug) && guide.picks.length > 0 && <p className="gg-itemcount" data-gift-item-count="">{G.itemCount(guide.picks.length)}</p>}
                  </div>
                  {tools}
                </div>
              )}
            </>
          )} />
        {/* Owner 11-21 ("put like a line or something above all guides and under search bar all the way across to be a
            divider"): one hairline across the content width, under the search row and above the menu and the guides. */}
        {landing && <hr className="gg-divider" data-gift-divider="" />}
        {/* Holiday audit 1121 #22 / #27: the page comes first in the code (keyboard and screen readers met 16 menu links
            before the gifts), then the menu, then the disclosures, so a phone reads and shows them in that order, the
            disclosures at the very bottom. From 768px the CSS grid puts the menu on the left (GIFT_GUIDES_CSS). */}
        <div className="gg-layout">
          <div className="gg-main">
            {deals ? <LazyDeals key={deals.id} day={deals} /> : guide ? (search && sm?.searchNeedsTags(search) && !kidTags ? <p className="gg-soon" role="status">{WISH.loading}</p> : <><GiftGuideView guide={guide} order={sortOrder} hideCount={countRow} filter={headerFilter} />{sm && <sm.GuideSearchLinks slug={guide.slug} />}</>)
              : searchSlug ? (searchMod === "failed" ? <p className="gg-soon" role="alert">{G.picksFailed}</p> : <p className="gg-soon" role="status">{WISH.loading}</p>) : shared ? <LazySharedList code={code} /> : myList ? <LazyMyList /> : <GiftGuideLanding />}
          </div>
          {/* A shared list marks nothing current either (holiday audit 1121: it marked "All guides"). */}
          <GiftGuidesSidebar active={guide} myList={myList || shared} mine={myList} page={sidePage} />
          {footer}
        </div>
      </div>
    </PublicHeaderPage>
  );
}
