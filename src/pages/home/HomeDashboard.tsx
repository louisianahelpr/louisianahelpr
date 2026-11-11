import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { HOME_SHELL_ID } from "@/components/landing/homeShell";
import { greetingDate, greetingFor, readGreetingName, saveGreetingName } from "@/lib/homeGreetingShell.mjs";
import { YourPageLink } from "@/components/profile/YourPageLink";
import { FirstRun } from "@/components/firstRun/FirstRunHost";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { GroupSection, GroupRow } from "@/components/sections/StatusBoxes";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, openingSoonLine } from "@/components/mobileNav/useSectionTabs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHomeSummary } from "./homeDashboard/useHomeSummary";
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
import { PageTitleBar } from "@/components/header/PageTitleBar";
import { JobProgress } from "@/components/tracker/JobProgress";
import { PayoutFailedCard } from "@/components/money/PayoutFailedCard";
import { FirstJobHome, useFirstJobState } from "./homeDashboard/FirstJobHome";
import { PosterFirstJobCard } from "./homeDashboard/PosterFirstJobCard";
import { WelcomeCard } from "./homeDashboard/WelcomeCard";
import { HelprsNearYou } from "./homeDashboard/HelprsNearYou";
import { useHomeTopSettled, useHoldWhileFirstVisitReads } from "./homeDashboard/homeTopSettled";
import { HeldBlocksSkeleton } from "./homeDashboard/HeldBlocksSkeleton";
import { optionalLazy } from "@/lib/optionalLazy";
import { useLanguage, getLang, t as tNow } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";
import "@/lib/i18n/enHome";
// Loaded the first time it opens, never with Home's first screen (AUD31-60, B61): it brings Sheet and Switch.
const CustomizeSheet = lazy(() => import("@/components/sections/CustomizeSheet").then((m) => ({ default: m.CustomizeSheet })));
const SmsPhonePrompt = optionalLazy(() => import("@/components/notificationPreferences/SmsPhonePrompt").then((m) => ({ default: m.SmsPhonePrompt })), "SmsPhonePrompt");

// The hours rule and the date line are shared with index.html's HTML-drawn greeting (homeGreetingShell.mjs, Q1158).
const greeting = () => greetingFor(new Date(), getLang());

/** "Sat, Oct 24 2:00 PM": when, for a phone Coming up row (board 7). */
function whenLine(c: ComingUpItem) {
  return [c.day, c.time].filter(Boolean).join(" ");
}

const sectionDef = (key: string) => SECTIONS.find((d) => d.key === key) ?? SECTIONS[0];
/** A section's name as the member reads it (F260q: "Ventas" in Spanish); the config keeps its English label. */
const sectionLabel = (d: { path: string; label: string }) => { const k = navKey(d.path, d.label); return k ? tNow(k) : d.label; };

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
/** Next up shows at most this many dots: five 44px targets fit the 320 card; See all lists the rest. */
const NEXT_UP_MAX_DOTS = 5;

function HomeDashboardScreen() {
  const { t, lang } = useLanguage();
  // Q2705 B: index.html drew this page's skeleton first (#lh-home-shell); take it away once the greeting is painted.
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
  const queryClient = useQueryClient();
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();
  const isLive = (s: (typeof visible)[number]) => s.feature === null || !!live.find((tab) => tab.path === s.path)?.on;
  const soonLine = openingSoonLine(visible.filter((s) => !isLive(s)).map(sectionLabel), { and: t("home.and"), one: t("home.soonOne"), many: t("home.soonMany") });
  const isWebDesktop = useIsWebDesktop();
  // Plain state, never stored: a remount (load, coming back) starts collapsed.
  const [todoOpen, setTodoOpen] = useState(false);
  const toggleTodo = () => setTodoOpen((o) => !o);
  // True until the first-run tour is settled (it reports pending): the texts ask waits behind it.
  const [firstRunActive, setFirstRunActive] = useState(true);
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
  // Q1158: until the profile is read, the name this device kept for THIS account (the one index.html's greeting drew),
  // so the greeting never drops the name and grows it back; once read, the profile's name is kept for the next cold load.
  const first = profileFirst ?? readGreetingName(user?.id);
  useEffect(() => {
    if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst);
  }, [user?.id, profileFirst]);
  const today = greetingDate(new Date(), lang);
  const todoCount = summary.todos.length;

  // Next up is a carousel over the to-dos (mock-up 7: "Next up · 1 of 5"); it opens on the most urgent.
  const [shown, setShown] = useState(0);
  const at = Math.min(shown, Math.max(0, todoCount - 1));
  const next = summary.todos[at];
  // Design audit A D3 (owner approved 11-08): a new member with nothing to do sees ONE welcome card (WelcomeCard) in
  // place of "You're all caught up" and an empty "Coming up". Same "new" rule as the first-job checklist below.
  const welcome = !!firstJob?.isNew && !summary.usesDeclutter && !next && !summary.todosLoading && !summary.waiting;
  const rest = Math.max(0, todoCount - 1);
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
      <div data-testid="home-dashboard" className="flex flex-col gap-section">
        {/* The search bar sits in the top bar above this (design audit A D1, owner 11-08: it replaced the H crest). */}
        {/* ONE header row (owner 2026-10-21): on the desktop website the greeting is the bar's title
            (spec v2: Home's greeting in the same slot as every title) and the date opens the page. */}
        <PageTitleBar
          moment
          desktopGap={false}
          title={first ? `${greeting()}, ${first}` : greeting()}
          phone={
            <div>
              {/* Design audit A D1 (owner 11-08): one 20px line under the search bar; the date line is gone. The bar is
                  the Vinted header, so the page's name is a hidden h1 like every section's (one page-title size, Q236e). */}
              <h1 className="sr-only">{t("home.h1")}</h1>
              <p data-home-greeting="" className="text-ds-20 font-bold leading-tight text-foreground">{first ? `${greeting()}, ${first}` : greeting()}</p>
            </div>
          }
        />
        {isWebDesktop && <p className="text-ds-14 text-muted-foreground pt-5 -mb-2" data-home-date="">{today}</p>}

        {/* Board 11 (desktop): TWO columns under the greeting from 1280px (below that the left column is
            too narrow for the Coming up table). Left (~60%): Next up, To do, Coming up (a table from
            900px). Right (~40%): the money tiles, then YOUR SECTIONS as a compact 2x2. The phone keeps one column in the same order. */}
        {!topSettled && (
          <section data-testid="home-top-loading" aria-busy="true" aria-label={t("home.loadingAria")} className="liquid-glass p-card flex flex-col gap-1.5">
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
            {welcome ? <WelcomeCard sell={visible.filter(isLive).some((v) => v.key === "declutter")} /> : (
            // F083 (owner UI audit 11-09): the card is named "Needs you" here as everywhere else (it was "Next up").
            <section ref={nextUpRef} data-testid="next-up" aria-label={t(NEEDS_YOU_KEY)} className="liquid-glass p-card flex flex-col gap-1.5" style={summary.todosLoading && nextUpReserve ? { minHeight: nextUpReserve } : undefined}>
              <div className="flex items-center justify-between gap-3">
                <h2 data-testid="next-up-label" className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {!next && summary.waiting ? summary.waiting.label : todoCount > 1 ? t("home.needsYouOf", { at: at + 1, n: todoCount }) : t(NEEDS_YOU_KEY)}
                </h2>
                {!next && summary.waiting && (
                  <Button type="button" variant="ghost" size="sm" data-testid="next-up-see-job" onClick={() => navigate(`/jobs/${summary.waiting!.jobId}`)} className="px-1 -my-2 -mr-1 text-ds-13 tracking-normal text-primary">
                    {t("home.seeJob")}
                  </Button>
                )}
                {next && (() => {
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
              {next ? (
                <>
                  <p data-testid="next-up-title" className="text-ds-18 font-bold leading-snug text-foreground [overflow-wrap:anywhere]">{next.title}</p>
                  <p className="text-ds-14 text-muted-foreground">
                    {next.money && <span className="font-bold" style={{ color: "hsl(var(--accent-ink))" }}>{t("home.orderTotal", { amount: next.money })}</span>}
                    {next.money && " · "}
                    {next.meta}
                  </p>
                  {/* Board 7: dots left, See all + the ONE action right. Every dot is a 44px target (index.css floor),
                      so at 320/375 they cannot share a line with the rest: the See all + action group WRAPS as one
                      piece below the dots (See all left, action right) instead of covering them (axe target-size,
                      TRAIN23). At most 5 dots fit 320; See all lists every to-do. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    {todoCount > 1 && (
                      <div className="flex items-center -ml-2 lg:hidden" role="group" aria-label={t("home.yourTodos")}>
                        {summary.todos.slice(0, NEXT_UP_MAX_DOTS).map((td, i) => (
                          <button
                            key={td.id}
                            type="button"
                            data-next-up-dot={i}
                            aria-label={t("home.todoDot", { at: i + 1, n: todoCount })}
                            aria-current={i === at ? "true" : undefined}
                            onClick={() => setShown(i)}
                            className="h-11 w-5 flex items-center justify-center"
                          >
                            <span aria-hidden className={`h-1.5 rounded-full transition-all ${i === at ? "w-4 bg-primary" : "w-1.5 bg-border"}`} />
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Desktop (board 11): no dots; the action first, then See all beside it. */}
                    <div data-next-up-actions className="ml-auto grow flex items-center justify-between gap-3 lg:ml-0 lg:grow-0 lg:flex-row-reverse lg:justify-end">
                      {rest > 0 ? (
                        // The shared link Button (owner 11-06 pop-up: switch; 2px narrower, desktop hover underline).
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          data-testid="next-up-see-all"
                          aria-expanded={todoOpen}
                          aria-controls={todoOpen ? "home-todo-list" : undefined}
                          onClick={toggleTodo}
                          className="px-1 -ml-1 text-ds-13 font-bold text-primary whitespace-nowrap"
                        >
                          {todoOpen ? t("home.hide") : t("home.seeAll", { n: todoCount })}
                        </Button>
                      ) : <span />}
                      <Button type="button" size="sm" data-testid="next-up-action" onClick={() => navigate(todoTarget(next, requestHelperStep))} className="px-5 text-ds-15 font-semibold tracking-normal shadow-none shrink-0">
                        {next.action}
                      </Button>
                    </div>
                  </div>
                </>
              ) : summary.todosLoading || money.pending ? (
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

            {todoOpen && (
              <div data-testid="todo-list" id="home-todo-list">
                <GroupSection title={t("home.todo")} count={todoCount}>
                  {summary.todos.map((td, i, arr) => (
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
              <ErrorState
                variant="inline"
                title={t("home.comingUpFailed")}
                body={t("home.comingUpFailedBody")}
                onRetry={() => void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" })}
              />
            ) : welcome && summary.upcoming.length === 0 ? null : (
            <GroupSection title={t("home.comingUp")}>
              {summary.upcoming.length === 0 ? (
                <p data-testid="coming-up-empty" className="px-4 py-4 text-ds-14 text-muted-foreground">{summary.hasBookedJob ? t("home.nothingElse") : t("home.nothingYet")}</p>
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
                        <span aria-hidden data-coming-up-section={c.section} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted">
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

            {/* Design audit A D2 (owner approved 11-08): "Needs you" comes first, the first-week checklist after it as one
                progress line. Board 189: before a member's first job, the first-job checklist and jobs near them.
                A3-82: not for a member who came to sell or buy on Declutter. */}
            {firstJob?.isNew && !summary.usesDeclutter && <FirstJobHome profile={profile} alertsOff={firstJob.alertsOff} />}
            {/* UX-5: the poster's first week (posted, hired, approved) until a posted job is finished. */}
            {firstJob && !firstJob.isNew && <PosterFirstJobCard userId={user?.id} />}
            </>}
          </div>

          {holdBelowNextUp && <HeldBlocksSkeleton side />}
          {!holdBelowNextUp && <section data-home-side className="flex flex-col gap-2 min-w-0" aria-label={t("home.yourSections")}>
            {/* Owner request 11-05: "add their URL to the home page somewhere so they can easily find it to share". The
                handle comes from the profile row Home already has, so this makes no request; outline buttons only, so
                Home keeps its one primary action. Owner 11-10: the card sits at the TOP of the right column. */}
            {profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className="mb-2" />}
            <HomeMoneyTiles money={money} placement="side" />
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-ds-15 font-semibold text-foreground">{t("home.yourSections")}</h2>
              <Button type="button" variant="link" size="sm" data-testid="open-customize" onClick={() => setCustomize(true)} className="px-0 text-ds-13 font-semibold tracking-normal text-primary">
                {t("home.customize")}
              </Button>
            </div>
            {/* Design audit A D4 (owner approved 11-08): the member's OPEN sections as one row of chips, each with its real
                count line when there is one ("Jobs · 1 needs you"); the bottom bar already holds every section, so the
                old 2x2 boxes repeated it. The rest share ONE compact line (owner, 2026-10-21: no "Opening soon" cards). */}
            <div data-section-chips="" className="flex flex-wrap gap-2">
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
                    className="max-w-full gap-1.5 rounded-full px-3.5 text-ds-13 font-semibold tracking-normal"
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
          </section>}
        </div>}

      </div>
      {customizeMounted && <Suspense fallback={null}><CustomizeSheet open={customize} onOpenChange={setCustomize} /></Suspense>}
      {/* Board 53 + the short coach-mark tour (owner 2026-10-20). It replaced the 7-step OnboardingTour,
          which only ever opened on /home from the Jobs feed and so never showed once Home moved here. */}
      <FirstRun userId={user?.id} onActiveChange={setFirstRunActive} />
      {/* SMS-OPTIN (owner 2026-10-29): members who gave a phone are asked once to turn texts on; never over the tour. */}
      {!firstRunActive && <Suspense fallback={null}><SmsPhonePrompt moment="has_phone" /></Suspense>}
    </SectionScreen>
  );
}
