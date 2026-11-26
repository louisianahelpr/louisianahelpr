import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { HOME_SHELL_ID } from "@/components/landing/homeShell";
import { greetingDate, greetingFor, readGreetingName, saveGreetingName } from "@/lib/homeGreetingShell.mjs";
import { YourPageLink, publicPageQuery } from "@/components/profile/YourPageLink";
import { fetchPublicProfile } from "@/lib/profileLink/api";
import { takeHomeOwnPagePrefetch } from "./homeDashboard/homePrefetchTake";
import { TourReplayHost } from "@/components/tour/TourReplayHost";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { SEARCH_ICON_BUTTON_CLASS } from "@/components/ui/SearchIconButton";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { GroupSection, GroupRow } from "@/components/sections/StatusBoxes";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, openingSoonLine } from "@/components/mobileNav/useSectionTabs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHomeSummary, usePageSettled } from "./homeDashboard/useHomeSummary";
import { todoTarget } from "./homeDashboard/useNeedsYouTodos";
import { requestHelperStep } from "@/components/job-card/helperStepRequest";
import { type ComingUpItem } from "./homeDashboard/comingUp";
import { useHomeMoney } from "./homeDashboard/homeMoney";
import { HomeMoneyTiles } from "./homeDashboard/HomeMoneyTiles";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { readReservedHeight, useReservedHeight } from "./homeDashboard/reservedHeight";
import { useOnTabReselect } from "@/components/mobileNav/tabReselect";
import { feedLinkTarget } from "./homeDashboard/feedLinkForward";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { PageTitleBar } from "@/components/header/PageTitleBar";
import { JobProgress } from "@/components/tracker/JobProgress";
import { PayoutFailedCard } from "@/components/money/PayoutFailedCard";
import { FirstJobHome, useFirstJobState } from "./homeDashboard/FirstJobHome";
import { PosterFirstJobCard } from "./homeDashboard/PosterFirstJobCard";
import { HelprsNearYou } from "./homeDashboard/HelprsNearYou";
import { useHomeTopSettled, useHoldWhileFirstVisitReads } from "./homeDashboard/homeTopSettled";
import { HeldBlocksSkeleton } from "./homeDashboard/HeldBlocksSkeleton";
import { HOME_NEEDS_YOU_MIN_PX } from "@/lib/homeSkeleton";
import { optionalLazy } from "@/lib/optionalLazy";
import { loadModule, untilReload } from "@/lib/loadModule";
import { useLanguage, getLang, t as tNow } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";
import "@/lib/i18n/enHome";
import "@/lib/i18n/enSections";
// Loaded the first time it opens, never with Home's first screen (AUD31-60, B61): it brings Sheet and Switch.
// The Holiday gift guides banner (owner mockup A, 11-18): its own chunk, last in the side column, so nothing moves.
const GiftGuidesPromo = lazy(() => import("@/components/GiftGuidesPromo"));
import { giftPromoShows } from "@/components/giftGuidesPromoGate";
// Owner polish 11-20: Recent messages and Your active listings and jobs, under Your sections. Their own chunk, asked
// only once the page has settled, so they never weigh on Home's first load (/home's critical-path budget).
const HomeMoreRows = lazy(() => loadModule(() => import("./homeDashboard/HomeMoreRows")).then((m) => (m ? { default: m.default } : untilReload())));
// Owner polish 11-20: the "Needs you" short list and the empty Coming up buttons, in their own chunk (not on /home's
// critical path, Q178): started as Home mounts; until it lands Home draws its single to-do card and a 44px hold.
type FirstExtras = typeof import("./homeDashboard/homeFirstExtras");
let firstExtras: FirstExtras | null = null;
// A plain import (not lazyModule.ts, which would join home-shared on /home's critical path). A failed fetch keeps the
// single card and the 44px hold, and the next mount tries again; the chunk-reload recovery is main.tsx's.
// loadModule (dynamicImportThenDoesNoWork): an empty module (a prevented preload) answers null, the same as not loaded yet.
const loadFirstExtras = () => loadModule(() => import("./homeDashboard/homeFirstExtras")).then((m) => (m ? (firstExtras = m) : null));
const CustomizeSheet = lazy(() => import("@/components/sections/CustomizeSheet").then((m) => ({ default: m.CustomizeSheet })));
// Drawn only when a Coming up read fails, so the error card (and EmptyState under it) loads on its own and never rides
// Home's first load (/home's critical-path budget, 2026-11-14).
const ErrorState = lazy(() => loadModule(() => import("@/components/ui/ErrorState")).then((m) => (m ? { default: m.ErrorState } : untilReload())));
const SmsPhonePrompt = optionalLazy(() => import("@/components/notificationPreferences/SmsPhonePrompt").then((m) => ({ default: m.SmsPhonePrompt })), "SmsPhonePrompt");
// The new-member blocks (owner 11-14): their own chunks, so they never weigh on Home's first load for every other
// member (/home's critical-path budget, scripts/perf/critical-path-budget.json). One chunk for both (NewMemberHome.tsx
// re-exports the guide), requested on Home's first render: the guide is drawn for every member (it draws nothing once
// done or past its days), so the chunk is on its way while Home's reads decide whether the new-member block shows.
type NewMemberBlocks = typeof import("./homeDashboard/NewMemberHome");
function newMemberBlock<P extends object>(pick: (m: NewMemberBlocks) => ComponentType<P>) {
  const Block = lazy(() => loadModule(() => import("./homeDashboard/NewMemberHome")).then((m) => (m ? { default: pick(m) } : untilReload())));
  const Drawn = Block as unknown as ComponentType<P>;
  return (props: P) => <Suspense fallback={null}><Drawn {...props} /></Suspense>;
}
const NewMemberHome = newMemberBlock((m) => m.NewMemberHome);
const GetStartedGuide = newMemberBlock((m) => m.GetStartedGuide);
const NearYouBlock = newMemberBlock((m) => m.NearYouBlock);

// The desktop website's greeting: the hours rule and the date line (homeGreetingShell.mjs).
const greeting = () => greetingFor(new Date(), getLang());

/** "Sat, Oct 24 2:00 PM": when, for a phone Coming up row (board 7). */
function whenLine(c: ComingUpItem) {
  return [c.day, c.time].filter(Boolean).join(" ");
}

const sectionDef = (key: string) => SECTIONS.find((d) => d.key === key) ?? SECTIONS[0];
/** A section's name as the member reads it (F260q: "Ventas" in Spanish); the config keeps its English label. */
const sectionLabel = (d: { path: string; label: string }) => { const k = navKey(d.path, d.label); return k ? tNow(k) : d.label; };
/** A to-do's section icon and name, for the Needs you list rows (homeFirstExtras). */
const sectionOf = (key: string) => { const d = sectionDef(key); return { Icon: d.icon, label: sectionLabel(d) }; };

/**
 * HOME (owner final decisions, 2026-10-19; 2026-10-20 the three stat boxes became
 * the NEXT UP card, HELPR-DESIGN-SPEC §4). Greeting (Bodoni, a moment); Next up
 * (the most urgent to-do from every section and both sides, with its action);
 * the full To do list, COLLAPSED until Next up's "See all" is tapped, the one
 * control that opens it (owner, 2026-10-19: "only show To do expanded when
 * it's clicked"). Never remembered: Home arrives collapsed on
 * load, on coming back from a section, and on a re-tap of the Home tab. The
 * member's sections as 2x2 boxes; Coming up. No "+" and no category pills.
 */
export default function HomeDashboard() {
  const { search, hash } = useLocation();
  const forward = feedLinkTarget(search, hash);
  // A link that opens something IN the job feed goes to the feed (Jobs > Browse).
  if (forward) return <Navigate replace to={forward} />;
  return <HomeDashboardScreen />;
}

/** The card's name (F083, owner UI audit 11-09: "Pick one label ('Needs you') and use it everywhere"). */
const NEEDS_YOU_KEY = "home.needsYou" as const;
/** Needs you lists at most this many to-dos (owner polish 11-20: a short list); See all lists the rest. */
const NEXT_UP_LIST_MAX = 3;

function HomeDashboardScreen() {
  const { t, lang } = useLanguage();
  // Q2705 B: index.html drew this page's skeleton first (#lh-home-shell); take it away once this page is painted.
  useEffect(() => removeShellOncePainted(HOME_SHELL_ID), []);
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const summary = useHomeSummary(user);
  const firstJob = useFirstJobState(user?.id);
  const money = useHomeMoney(user);
  // F081 (owner UI audit 11-09): money is waiting on a payout account, so Next up asks for it instead of saying
  // "all caught up" or naming only someone else's turn. Same rule as the money tile's caption (HomeMoneyTiles).
  const setupPaused = usePayoutSetupPaused();
  const payoutAsk = money.coming && !money.coming.hasPayoutAccount && !setupPaused ? formatCents(money.coming.cents) : null;
  // First visit on this device (Next up is always drawn, so its height is saved after every settled load): no reserve
  // to hold for the to-dos or the money strip, so the blocks below Next up wait for those reads (homeTopSettled.ts).
  const firstVisit = useMemo(() => !!user?.id && !readReservedHeight(`next-up:${user.id}`), [user?.id]);
  // Q2706/Q2708 (Builder 3): until the first-week cards' reads answer, one placeholder stands in for everything below
  // the greeting, so a card arriving above Next up never pushes the page down (homeTopSettled.ts).
  const topSettled = useHomeTopSettled(user?.id, firstJob);
  const holdBelowNextUp = useHoldWhileFirstVisitReads(firstVisit && (summary.todosLoading || !!money.pending));
  // Page settle (builder3g-1115 handoff, shift 2): the section chips are the last blocks on the page, so they wait for
  // their late "near you" counts (capped at ARRIVAL_CAP_MS from when they would first show) and then paint once; a count
  // arriving after the chips painted wrapped "Declutter · N items near you" onto a new row and moved Shops with it.
  const chipsReady = useArrivalGate(!holdBelowNextUp, !summary.tilesPending);
  const queryClient = useQueryClient();
  // Home LCP (prod-audit 43650083979, 11-14): the Your page card mounts only once the top cards settle, and it then
  // asked whether the page opens, so on a phone its line was /home's largest paint at 9.8 s. Ask as soon as the
  // profile names the handle, beside the top cards' reads; the card then draws from the cache when it mounts.
  // Q2705 (11-15): on a cold load the entry has usually read it already (homePrefetch.ts); that answer is taken once.
  const myHandle = profile?.handle ?? null;
  const myId = user?.id ?? null;
  useEffect(() => {
    if (!myHandle) return;
    void queryClient.prefetchQuery({
      ...publicPageQuery(myHandle),
      queryFn: async () => fetchPublicProfile(myHandle, myId ? await takeHomeOwnPagePrefetch(myId, myHandle) : null),
    });
  }, [myHandle, myId, queryClient]);
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();
  // Owner 2026-11-17: an unlaunched section (Shops, Homes for a tester) gets no chip either, the same `listed` answer.
  const isLive = (s: (typeof visible)[number]) => s.feature === null || (!!live.find((tab) => tab.path === s.path)?.on && live.find((tab) => tab.path === s.path)?.listed !== false);
  // M8 (owner 11-16): a closed section is not listed, so it is not named in the "opening soon" line either.
  const soonLine = openingSoonLine(visible.filter((s) => !isLive(s) && live.find((tab) => tab.path === s.path)?.listed !== false).map(sectionLabel), { and: t("home.and"), one: t("home.soonOne"), many: t("home.soonMany") });
  const isWebDesktop = useIsWebDesktop();
  // Plain state, never stored: a remount (load, coming back) starts collapsed.
  const [todoOpen, setTodoOpen] = useState(false);
  const toggleTodo = () => setTodoOpen((o) => !o);
  // True while Help's tour replay is on screen: the texts ask waits behind it. Seeded from the URL, so on
  // /home?tour=1 the ask never mounts for the one render before the replay host reports itself open.
  const [tourActive, setTourActive] = useState(() => new URLSearchParams(window.location.search).get("tour") === "1");
  useOnTabReselect("/home", () => setTodoOpen(false));
  // Profile's "Your sections" row opens Home with ?customize=1.
  const [params, setParams] = useSearchParams();
  const [customize, setCustomizeState] = useState(params.get("customize") === "1");
  // Mounted from the first open on, so the sheet still animates closed.
  const [customizeMounted, setCustomizeMounted] = useState(customize);
  const setCustomize = (open: boolean) => {
    setCustomizeState(open);
    if (open) setCustomizeMounted(true);
    if (!open && params.has("customize")) setParams((p) => { const n = new URLSearchParams(p); n.delete("customize"); return n; }, { replace: true });
  };
  const profileFirst = profile ? profile.full_name?.split(" ")[0] ?? "" : null;
  // Q1158: until the profile is read, the name this device kept for THIS account, so the desktop website's greeting
  // never drops the name and grows it back; once read, the profile's name is kept for the next cold load.
  const first = profileFirst ?? readGreetingName(user?.id);
  useEffect(() => {
    if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst);
  }, [user?.id, profileFirst]);
  const today = greetingDate(new Date(), lang);
  const [promoShows] = useState(() => giftPromoShows());
  const todoCount = summary.todos.length;
  const [extras, setExtras] = useState<FirstExtras | null>(firstExtras);
  useEffect(() => {
    if (!extras) loadFirstExtras().then(setExtras, () => undefined /* the single card and the hold stay; see loadFirstExtras */);
  }, [extras]);

  // Owner polish 11-20: Needs you is a SHORT LIST of the to-dos (most urgent first), no longer a carousel with dots
  // ("Needs you · 1 of 3"). One to-do keeps the big single card; more list up to NEXT_UP_LIST_MAX rows, each with its
  // own action, and See all opens the rest below. Guards: src/test/homeBoard7.test.ts, src/test/dashboardsShell.test.tsx.
  const next = summary.todos[0];
  const listed = todoCount > 1 ? summary.todos.slice(0, NEXT_UP_LIST_MAX) : [];
  // Design audit A D3 (owner approved 11-08): a new member with nothing to do sees the new-member block (NewMemberHome:
  // Get started, jobs and items near them) in place of "You're all caught up" and an empty "Coming up". Same "new" rule
  // as the first-job checklist below. (Its welcome card went on 2026-11-24, owner.)
  const welcome = !!firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && !next && !summary.todosLoading && !summary.waiting;
  const sellOpen = visible.filter(isLive).some((v) => v.key === "declutter");
  // Get started (owner 11-14): starts on the new-member block and stays, while steps are left, once the member acts.
  const guide = (fresh: boolean) => (
    <GetStartedGuide userId={user?.id} fresh={fresh} declutterOpen={sellOpen} hasPhoto={!!profile?.avatar_url} alertsOff={firstJob ? firstJob.alertsOff : null} />
  );
  const rest = Math.max(0, todoCount - Math.max(1, listed.length));
  // Owner 2026-11-17 (item 4): a quiet day (nothing needs you, nothing booked) showed "Near you" under Coming up, its
  // chunk and reads asked only once the page has settled (usePageSettled), so Home's first paint is unchanged.
  // Owner polish 11-20 ("fill the empty space with useful rows"): every settled day, not only a quiet one.
  const pageSettled = usePageSettled();
  // Not for a new member: their own blocks (NewMemberHome, FirstJobHome) already list the jobs near them.
  // Only the new-member rule (their own blocks list what is near them), once that read has answered; no wait on the
  // other reads (a Declutter read that never settles kept it hidden on a member's 1440 Home, 11-20).
  // Parent 11-20 shot: a new member who sells or buys on Declutter (no FirstJobHome) saw a blank Home; Near you shows
  // whenever the first-job block does not.
  const firstJobShown = !!firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending;
  const nearYouDay = !welcome && firstJob !== null && !firstJobShown;
  // Q2706 (B98): while their reads are out, Next up and the money strip hold the height they had last time on this
  // device (reservedHeight.ts), so the blocks below them do not move when they land.
  const nextUpRef = useRef<HTMLElement>(null);
  const nextUpReserve = useReservedHeight(user ? `next-up:${user.id}` : null, summary.todosLoading, nextUpRef);
  const moneyReserve = useReservedHeight(user ? `money-main:${user.id}` : null, !!money.pending, () => document.querySelector<HTMLElement>('[data-home-money="main"]'));

  return (
    // The Vinted header on Dashboard too (owner 11-08, design audit A D1, approved 11-08): "Search jobs and items" (a link
    // to /search, which searches every open section), the bell (which holds Messages) and the photo; no crest. "+ Create"
    // floats over the page and opens the Create sheet.
    <SectionScreen search={<SectionSearchBar noun={t("home.searchNoun")} home="/search" />} fab={<SectionCreateFab />}>
      {/* Design audit r2 #40: without a greeting row (phone) the first card sat 6px under the search bar (the bar's 2px +
          the column's 4px) while the cards below sit 16px apart; 10px more, here and in its skeleton (index.html too). */}
      <div data-testid="home-dashboard" className={`flex flex-col gap-section${isWebDesktop ? "" : " pt-2.5"}`}>
        {/* The search bar sits in the top bar above this (design audit A D1, owner 11-08: it replaced the H crest). */}
        {/* ONE header row (owner 2026-10-21): on the desktop website the greeting is the bar's title
            (spec v2: Home's greeting in the same slot as every title) and the date opens the page. */}
        <PageTitleBar
          moment
          desktopGap={false}
          title={first ? `${greeting()}, ${first}` : greeting()}
          // Design audit area 02 #6 (11-18): the desktop website's Home had no search at all (the phone's sits in its top
          // row). The same /search link, as the desktop search pill, beside the greeting in the bar.
          actions={
            // Owner 11-21 (pop-up, "just the icon"): the shared magnifier, never a wide always-open box; it opens /search.
            <Link to="/search" data-testid="home-desktop-search" data-search-icon="" aria-label={`${t("section.search")} ${t("section.noun.jobsAndItems")}`}
              title={`${t("section.search")} ${t("section.noun.jobsAndItems")}`} className={`${SEARCH_ICON_BUTTON_CLASS} min-h-11 min-w-11`}>
              <Search className="w-5 h-5" aria-hidden />
            </Link>
          }
          // Phone: no greeting (owner 11-14, Depop/Vinted audit item 6: the page opens straight on Next up under the
          // search bar). The page's name is a hidden h1 like every section's (one page-title size, Q236e); index.html's
          // copy of this page (#lh-home-shell) draws no greeting either. Guard: src/test/homeGreetingShell.test.tsx.
          phone={<h1 className="sr-only">{t("home.h1")}</h1>}
        />
        {isWebDesktop && <p className="text-ds-14 text-muted-foreground pt-5 -mb-2" data-home-date="">{today}</p>}
        {/* Owner 11-21 ("move this to under good evening lexi like one long strip"): the gift guides strip, right under the
            greeting (phone: the top of the page). Its chunk is lazy; its slot (56px phone, 48px from sm) is held from the first paint while it
            loads, so nothing under it moves. Guard: src/test/homeGiftStripAndSideBox1121.test.tsx. */}
        {promoShows && <Suspense fallback={<div aria-hidden data-gift-promo-hold="" className="h-14 sm:h-12" />}><GiftGuidesPromo where="home" /></Suspense>}

        {/* Board 11 (desktop): TWO columns under the greeting from 1280px (below that the left column is
            too narrow for the Coming up table). Left (~60%): Next up, To do, Coming up (a table from
            900px). Right (~40%): the money tiles, then YOUR SECTIONS as a compact 2x2. The phone keeps one column in the same order. */}
        {!topSettled && (
          <section data-testid="home-top-loading" aria-busy="true" aria-label={t("home.loadingAria")} className="liquid-glass p-card flex flex-col gap-1.5" style={{ minHeight: HOME_NEEDS_YOU_MIN_PX }}>
            <span className="sr-only">{t("home.loadingSr")}</span>
            <p aria-hidden className="text-ds-12">&nbsp;</p>
            <p aria-hidden className="text-ds-18 font-bold leading-snug"><span className="inline-block w-3/4 rounded-md bg-muted animate-pulse">&nbsp;</span></p>
            <p aria-hidden className="text-ds-14"><span className="inline-block w-1/2 rounded-md bg-muted animate-pulse">&nbsp;</span></p>
            <div aria-hidden className="h-11 mt-1" />
          </section>
        )}
        {topSettled && <div data-home-columns className="flex flex-col gap-section xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-6 xl:items-start">
          <div data-home-main className="flex flex-col gap-section min-w-0">
            {/* Board 143: a failed bank payout, first under the greeting; renders nothing unless one is open. */}
            <PayoutFailedCard />

            {/* Q2008: faces of opted-in members in your parish, "active now" dot; nothing until one opts in. */}
            <HelprsNearYou userId={user?.id} />

            {/* NEXT UP (owner, 2026-10-20; HELPR-DESIGN-SPEC §4 Home): the single most urgent
                to-do from every section and both sides, with its one action. Replaces the three
                stat boxes. Nothing invented: no to-do, no task; the money line only when the
                to-do carries a real amount. "See all" is the ONE control for the full list. */}
            {/* Owner 11-14: a new member's Home leads with the Get started guide (its rows are the starting actions)
                and the real jobs and items near them (NewMemberHome), not an empty "Nothing booked yet". */}
            {welcome ? <NewMemberHome userId={user?.id} sell={sellOpen} guide={guide(true)} /> : (
            // F083 (owner UI audit 11-09): the card is named "Needs you" here as everywhere else (it was "Next up").
            <section ref={nextUpRef} data-testid="next-up" aria-label={t(NEEDS_YOU_KEY)} className="liquid-glass p-card flex flex-col gap-1.5" style={summary.todosLoading && nextUpReserve ? { minHeight: nextUpReserve } : undefined}>
              <div className="flex items-center justify-between gap-3">
                <h2 data-testid="next-up-label" className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {!next && summary.waiting ? summary.waiting.label : todoCount > 1 ? t("home.needsYouN", { n: todoCount }) : t(NEEDS_YOU_KEY)}
                </h2>
                {!next && summary.waiting && (
                  <Button type="button" variant="ghost" size="sm" data-testid="next-up-see-job" onClick={() => navigate(`/jobs/${summary.waiting!.jobId}`)} className="px-1 -my-2 -mr-1 text-ds-13 tracking-normal text-primary">
                    {t("home.seeJob")}
                  </Button>
                )}
                {next && !(listed.length > 0 && extras) && (() => {
                  // Board 7: the to-do's section, by icon and name, top right.
                  const d = sectionDef(next.section);
                  const Icon = d.icon;
                  return (
                    <span data-testid="next-up-section" className="inline-flex items-center gap-1.5 text-ds-13 font-semibold text-foreground">
                      <Icon className="w-4 h-4 text-primary" aria-hidden />
                      {sectionLabel(d)}
                    </span>
                  );
                })()}
              </div>
              {next && listed.length > 0 && extras ? (
                <extras.NeedsYouList todos={listed} total={todoCount} rest={rest} open={todoOpen} onToggle={toggleTodo} sectionOf={sectionOf} onGo={(td) => navigate(todoTarget(td, requestHelperStep))} />
              ) : next ? (
                <>
                  <p data-testid="next-up-title" className="text-ds-18 font-bold leading-snug text-foreground [overflow-wrap:anywhere]">{next.title}</p>
                  <p className="text-ds-14 text-muted-foreground">
                    {next.money && <span className="font-bold" style={{ color: "hsl(var(--accent-ink))" }}>{t("home.orderTotal", { amount: next.money })}</span>}
                    {next.money && " · "}
                    {next.meta}
                  </p>
                  <Button type="button" size="sm" data-testid="next-up-action" onClick={() => navigate(todoTarget(next, requestHelperStep))} className="self-end mt-1 px-5 text-ds-15 font-semibold tracking-normal shadow-none shrink-0">
                    {next.action}
                  </Button>
                </>
              ) : summary.todosLoading || money.pending || (!!firstJob?.isNew && summary.declutterPending) ? (
                /* Q2706 (B98): the to-dos are still loading. Never "all caught up" before the reads answer; hold the
                   to-do card's own size (title, meta, the 44px action row) so nothing moves when it lands. */
                <>
                  {/* Builder 3 (11-04): a real line, not only a grey bar: the to-do's title then fills this same <p>, so
                      the page's first big paint stays the greeting (live lab: with a bar only, /home's LCP moved from
                      the greeting at 1.06 s to the to-do title at 2.28 s on Fast 4G). */}
                  <p data-testid="next-up-loading" className="text-ds-18 font-bold leading-snug text-muted-foreground" role="status">
                    {t("home.checking")}
                  </p>
                  <p aria-hidden className="text-ds-14 text-muted-foreground">{t("home.oneMoment")}</p>
                  <div aria-hidden className="h-11 mt-1" />
                </>
              ) : payoutAsk ? (
                <>
                  <p data-testid="next-up-title" className="text-ds-18 font-bold leading-snug text-foreground [overflow-wrap:anywhere]">{t("home.payoutTitle", { amount: payoutAsk })}</p>
                  <p className="text-ds-14 text-muted-foreground">{t("home.payoutBody")}</p>
                  <Button type="button" size="sm" data-testid="next-up-payout" onClick={() => navigate("/profile?tab=payment")} className="self-end mt-1 px-5 text-ds-15 font-semibold tracking-normal shadow-none">
                    {t("home.setUp")}
                  </Button>
                </>
              ) : summary.waiting ? (
                /* Board 83: nothing is mine to do, so Next up says who is up; never blank. */
                <div data-testid="next-up-waiting" className="flex flex-col gap-1.5">
                  <p data-testid="next-up-title" className="text-ds-18 font-bold leading-snug text-foreground line-clamp-2 [overflow-wrap:anywhere]">{summary.waiting.title}</p>
                  <p className="text-ds-14 text-muted-foreground">{summary.waiting.detail}</p>
                </div>
              ) : (
                <>
                  <p className="font-moment text-ds-22 leading-tight text-foreground">{t("home.caughtUp")}</p>
                  <p className="text-ds-14 text-muted-foreground">{t("home.caughtUpBody")}</p>
                </>
              )}
            </section>
            )}
            {!welcome && guide(false)}

            {todoOpen && (
              <div data-testid="todo-list" id="home-todo-list">
                {/* Design audit area 02 #8 (11-18): the list repeated the to-do the card above still shows; it lists the
                    others ("rest") and the card keeps its own. */}
                <GroupSection title={t("home.todo")} count={rest}>
                  {summary.todos.slice(listed.length).map((td, i, arr) => (
                    <GroupRow key={td.id} title={td.title} meta={td.meta} onClick={() => navigate(todoTarget(td, requestHelperStep))} last={i === arr.length - 1} />
                  ))}
                </GroupSection>
              </div>
            )}

            {holdBelowNextUp && <HeldBlocksSkeleton />}
            {!holdBelowNextUp && <>
            {/* LIVE NOW (spec v2 §5.1): only while a job of mine, either side, is happening. Directly BELOW Next up
                (owner decision 11-09, F204, reversing board 165's "above"): it comes with the activity reads, after Next up
                is on screen, and landing above it pushed the page down (CLS 0.19 Fast 4G / 0.42 Slow 4G, lab). Here it
                arrives with the blocks under Next up (held on a first visit until those reads answer), so nothing moves. */}
            {summary.liveNow && (() => {
              const l = summary.liveNow;
              const started = l.startedAt ? new Date(l.startedAt).toLocaleTimeString(lang === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" }) : null;
              return (
                <section data-testid="live-now" aria-label={t("home.liveNow")} className="liquid-glass p-card flex flex-col gap-1.5 border-2 border-primary">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.liveNow")}</h2>
                    {started && <span className="text-ds-13 font-semibold text-primary">{t("home.started", { time: started })}</span>}
                  </div>
                  <p data-testid="live-now-title" className="text-ds-18 font-bold leading-snug text-foreground line-clamp-2 [overflow-wrap:anywhere]">{l.title}</p>
                  <p className="text-ds-14 text-muted-foreground">{l.side}</p>
                  <div className="mt-1.5"><JobProgress progress={l.progress} compact /></div>
                  <Button type="button" size="sm" data-testid="live-now-action" onClick={() => navigate(`/jobs/${l.jobId}`)} className="self-start mt-2 px-5 text-ds-15 font-semibold tracking-normal shadow-none">
                    {t("home.openJob")}
                  </Button>
                </section>
              );
            })()}
            {/* MONEY STRIP (spec v2 §5.3): on phone right after Next up (board 7); from 1280 it moves to
                the top of the right column (board 11). Hidden when there is nothing real to show. */}
            {money.pending && !money.coming && !money.held && moneyReserve > 0
              ? <div data-home-money-reserve aria-hidden className="xl:hidden" style={{ minHeight: moneyReserve }} />
              : <HomeMoneyTiles money={money} placement="main" />}

            {/* Board 7 / spec v2 §5.4: Coming up is ONE agenda from every section and both sides (jobs,
                Declutter pickups, shop orders), sorted by when. Each row is its section's icon in a tinted
                circle, the title, and "<your side> · <when>". No price on a row (rust is money, and the
                board shows none); the item it opens has the money. */}
            {summary.upcoming.length === 0 && summary.upcomingFailed ? (
              /* A failed read is not "Nothing booked yet" (spec v2 §1.5): the shared error card, with a retry
                 of every read that failed on this screen. */
              <Suspense fallback={null}>
                <ErrorState
                  variant="inline"
                  title={t("home.comingUpFailed")}
                  body={t("home.comingUpFailedBody")}
                  onRetry={() => void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" })}
                />
              </Suspense>
            ) : welcome && summary.upcoming.length === 0 ? null : (
            <GroupSection title={t("home.comingUp")}>
              {summary.upcoming.length === 0 ? (
                // Owner polish 11-20: the empty agenda offers Post a job and Find work (ComingUpCta).
                <div className="px-4 py-4 flex flex-col gap-3">
                  <p data-testid="coming-up-empty" className="text-ds-14 text-muted-foreground">{summary.hasBookedJob ? t("home.nothingElse") : t("home.nothingYet")}</p>
                  {/* Its own chunk (homeFirstExtras); a 44px placeholder holds its row until it lands, so nothing moves. */}
                  {extras ? <extras.ComingUpCta /> : <div aria-hidden data-coming-up-cta-hold="" className="h-11" />}
                </div>
              ) : (
                summary.upcoming.map((c, i) => {
                  const d = sectionDef(c.section);
                  const Icon = d.icon;
                  const last = i === summary.upcoming.length - 1;
                  if (isWebDesktop) {
                    // Board 11: a table row: day · time · title · "<Section> · <your side>".
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-coming-up-table-row
                        data-coming-up-section={c.section}
                        onClick={() => navigate(c.to)}
                        className={`btn-press w-full text-left grid grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 ${last ? "" : "border-b border-border/70"}`}
                      >
                        <span className="text-ds-14 font-bold text-foreground truncate" title={c.day}>{c.day}</span>
                        <span className="text-ds-14 text-muted-foreground">{c.time}</span>
                        <span className="text-ds-15 font-semibold text-foreground leading-snug line-clamp-2 [overflow-wrap:anywhere]" title={c.title}>{c.title}</span>
                        <span data-coming-up-role={c.role} className="text-ds-13 text-muted-foreground whitespace-nowrap">
                          {sectionLabel(d)} · {t(`home.role.${c.role}`)}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <GroupRow
                      key={c.id}
                      leading={
                        <span aria-hidden data-coming-up-section={c.section} className="w-6 h-6 shrink-0 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-primary" />
                        </span>
                      }
                      title={c.title}
                      meta={<span data-coming-up-role={c.role}>{[t(`home.role.${c.role}`), whenLine(c)].filter(Boolean).join(" · ")}</span>}
                      onClick={() => navigate(c.to)}
                      last={last}
                    />
                  );
                })
              )}
            </GroupSection>
            )}
            {/* Owner polish 11-20: under Coming up, where Home was blank. Below everything drawn at first paint, so their
                late arrival moves nothing above them. Gated on the page settling ONLY (it fires within 4 s): the parent's
                1440 shot showed nothing here while the near-you counts (same settle) had drawn. */}
            {pageSettled && <Suspense fallback={null}><HomeMoreRows user={user} from={summary.activeFrom} /></Suspense>}
            {nearYouDay && pageSettled && <NearYouBlock userId={user?.id} sell={sellOpen} />}

            {/* Design audit A D2 (owner approved 11-08): "Needs you" comes first, the first-week checklist after it as one
                progress line. Board 189: before a member's first job, the first-job checklist and jobs near them.
                A3-82: not for a member who came to sell or buy on Declutter. */}
            {firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && <FirstJobHome profile={profile} alertsOff={firstJob.alertsOff} withGuide={welcome} />}
            {/* UX-5: the poster's first week (posted, hired, approved) until a posted job is finished. */}
            {firstJob && !firstJob.isNew && <PosterFirstJobCard userId={user?.id} />}
            </>}
          </div>

          {/* Owner 11-21 ("your profile etc needs a box around it"): the profile line and Your sections sit in ONE card, the
              same liquid-glass card as Needs you and Get started (empty:hidden: nothing in it yet draws no empty box); the
              held bones and the money tiles follow it, cards of their own. */}
          <section data-home-side className="flex flex-col gap-section min-w-0" aria-label={t("home.yourSections")}>
            <div data-home-side-card="" className="liquid-glass p-card flex flex-col gap-2 min-w-0 empty:hidden">
            {/* Owner request 11-05: "add their URL to the home page somewhere so they can easily find it to share". The
                handle comes from the profile row Home already has, so this makes no request; outline buttons only, so
                Home keeps its one primary action. Owner 11-10: the card sits at the TOP of the right column.
                Home LCP (lead 11-15, cwv-lab Slow 4G + 4x 375, test poster): the card is /home's largest paint, and it
                was held with the blocks below Next up until the activity read answered (8.1 s for an 831-job poster)
                although its own read had answered at 5.5 s. It is drawn as soon as the handle is known; only the
                blocks that wait on the activity read are held. Guard: src/test/homeYourPageNotHeld.test.ts. */}
            {profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className="mb-2" line />}
            {!holdBelowNextUp && <>
            <div className="flex items-baseline justify-between px-1">
              {/* Design audit 11-17 #27: the same eyebrow as "Needs you" and "Coming up" (GroupSection). */}
              <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.yourSections")}</h2>
              <Button type="button" variant="link" size="sm" data-testid="open-customize" onClick={() => setCustomize(true)} className="px-0 text-ds-13 font-semibold tracking-normal text-primary">
                {t("home.customize")}
              </Button>
            </div>
            {/* Design audit A D4 (owner approved 11-08): the member's OPEN sections as one row of chips, each with its real
                count line when there is one ("Jobs · 1 needs you"); the bottom bar already holds every section, so the
                old 2x2 boxes repeated it. The rest share ONE compact line (owner, 2026-10-21: no "Opening soon" cards). */}
            {chipsReady ? <>
            {/* Design audit area 02 #20 (11-18): at 390 the chips wrapped 1/2/1; a two-column grid keeps them in even rows. */}
            <div data-section-chips="" className="grid grid-cols-2 gap-2">
              {visible.filter(isLive).map((s) => {
                // Only a real line (spec v2 §1.5: never a "0"); with none the chip is the section's name alone.
                const line = summary.tiles[s.key];
                const Icon = s.icon;
                return (
                  <Button
                    key={s.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    data-section-tile={s.key}
                    onClick={() => navigate(s.path)}
                    className="w-full min-w-0 justify-start gap-1.5 rounded-full px-3.5 text-ds-13 font-semibold tracking-normal"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate" title={line ? `${sectionLabel(s)} · ${line}` : sectionLabel(s)}>
                      {sectionLabel(s)}
                      {line && <span data-tile-line className="font-normal text-muted-foreground"> · {line}</span>}
                    </span>
                  </Button>
                );
              })}
            </div>
            {soonLine && <p data-testid="sections-opening-soon" className="px-1 text-ds-13 text-muted-foreground">{soonLine}</p>}
            </> : <div data-section-chips-held="" aria-hidden className="h-9" />}
            </>}
            </div>
            {holdBelowNextUp && <HeldBlocksSkeleton side />}
            {!holdBelowNextUp && <HomeMoneyTiles money={money} placement="side" />}
          </section>
        </div>}

      </div>
      {customizeMounted && <Suspense fallback={null}><CustomizeSheet open={customize} onOpenChange={setCustomize} /></Suspense>}
      {/* Help's "Take the tour again" (owner 2026-10-20). Never opens by itself: the first-run picker
          is gone (owner 2026-11-24, C11), so a new account just lands on Home. */}
      <TourReplayHost userId={user?.id} onActiveChange={setTourActive} />
      {/* SMS-OPTIN (owner 2026-10-29): members who gave a phone are asked once to turn texts on; never over the tour
          and never over or under Customize (M2, iOS audit 11-16: the two sheets stacked). */}
      {!tourActive && !customize && <Suspense fallback={null}><SmsPhonePrompt moment="has_phone" /></Suspense>}
    </SectionScreen>
  );
}
