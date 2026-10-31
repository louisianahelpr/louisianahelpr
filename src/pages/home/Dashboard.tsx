import { useState, useCallback, useEffect, useMemo, useRef, Suspense, type ReactNode } from "react";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import { readStoredFeedDensity, type FeedDensity } from "@/components/dashboard/feedDensity";

import { toast } from "sonner";
import { openJobFromPin } from "@/components/browseMap/openJobFromPin";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBoostReturn } from "./useBoostReturn";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import { BrowseSearchBar } from "@/components/dashboard/browseTasksToolbar/BrowseSearchBar";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { BrowseFiltersButton, BrowseTasksActions } from "@/components/dashboard/browseTasksToolbar/BrowseTasksActions";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { useWantsQuotes } from "@/pages/home/useWantsQuotes";
import { WantsQuotesSlot } from "@/components/quotes/WantsQuotesSlot";
import { scrollFeedToTop } from "@/pages/home/scrollFeedToTop";
import { useIsWebDesktop } from "@/components/DesktopSidebarNav";
import { MapToggleButton } from "@/components/dashboard/browseTasksToolbar/MapToggleButton";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardBannedScreen } from "@/components/dashboard/DashboardBlockedScreen";

import { ApplyBody, ApplyConfirmDialog, BirthdayPopup, BrowseMap, JobDetailDialog, ReportDialog } from "./dashboardLazyParts";
import SectionBoundary from "@/components/SectionBoundary";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePendingSaveConsumer } from "@/hooks/usePendingSaveConsumer";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { ViewerFeedExclusions } from "@/pages/home/viewerFeedExclusions";
import { headerJobCount, sheetResultCount } from "@/pages/home/headerJobCount";
import { safeStorage } from "@/lib/safeStorage";
import { readJobsMapVisible, saveJobsMapVisible } from "@/lib/jobsMapVisible";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { useJobRef } from "@/hooks/useJobRef";
import { useViewerCredentialTier } from "@/hooks/useViewerCredentialTier";
import type { HelperAvailabilitySlot } from "./dashboardTypes";
import { QuickApplyHandler } from "./QuickApplyHandler";
import { useDashboardSideQueries } from "./useDashboardSideQueries";
import { useSaveJob } from "./useSaveJob";
import { useApplyFlow } from "./useApplyFlow";
import { useDetailJob } from "./useDetailJob";
import { useLoadMoreSentinel } from "./useLoadMoreSentinel";
import { useSavedOnlyPaging } from "./useSavedOnlyPaging";

/** Jobs > Browse (owner, 2026-10-19): `embeddedHeader` is the section's top bar + tabs; the feed adds ONE compact
 *  search row under it on phone. The old standalone phone title card (DashboardTitleBar + BrowseSearchBar) is gone:
 *  no route rendered it once /home became the Home dashboard (Q2205). */
const Dashboard = ({ embeddedHeader }: { embeddedHeader: (browse?: { end?: ReactNode; count?: number; onlySelected?: boolean }) => ReactNode }) => {
  const navigate = useNavigate();
  // Names the section this feed is the Browse tab of (Jobs; its top bar's h1).
  usePageTitle("Jobs — Helpr");

  // The Filters button lives in the title card (BrowseTasksActions) while the
  // filter panel lives in BrowseTasksToolbar below it. This page is the one
  // component that renders both, so it owns the ref that joins them — on the
  // desktop web the panel opens as a popover anchored to that button instead
  // of a modal sheet over the results. Phone + native are unaffected.
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  /* ONE PRESS OUT, AND THE FOCUS COMES BACK — the desktop feed strip.
     Measured live at 1400px before this: pressing the field's ✕ closed search
     in a single click and dropped `document.activeElement` on <body>
     (`{searchStillOpen:false, focusTag:"BODY", isBody:true}`). My Posts, the
     Messages inbox, Saved Helprs and the phone Browse row all hand focus back
     to the magnifier that opened the field; this was the one surface that did
     not, so a keyboard user pressing the dismiss was returned to the top of
     the document by the control whose whole job is "put me back where I was".

     The strip's magnifier UNMOUNTS while the field is open (it moves into the
     field — owner's ruling), so no ref inside BrowseTasksActions survives the
     round trip. Same technique DashboardTitleBar already uses for the phone
     row: hold the CONTAINER, and on the render where the field goes away
     focus the `[data-search-trigger]` that has just come back inside it. */
  const desktopStripRef = useRef<HTMLDivElement>(null);
  const hadDesktopSearchRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Capture ?ref= attribution from deep-links (push notifications, share
  // links, etc.) so analytics can attribute which surface drove the open.
  useJobRef();

  // WARM THE CREDENTIAL TIER HERE, NOT WHEN THE SHEET OPENS. Shared query key
  // and staleTime with the job sheet, so by the time a card is tapped the
  // answer is in cache and the sheet renders the right bottom on frame one.
  // Asking for it on open instead let `useQuery`'s 0 default read as a real
  // "lowest tier" verdict, and the sheet swapped footer-for-form 2.25s later
  // — a measured 28.9px of top-edge movement, ~95px once the apply form is no
  // longer the bigger late arrival. See the hook's own note.
  useViewerCredentialTier(true);

  const {
    user, profile, isAdmin, loading, helprTier, allJobs, platformFee,
    helperAvailability, recommendedJobs, refresh, loadError, feedPhase,
    fetchNextPage, hasNextPage, isFetchingNextPage,
    appliedJobIds, blockedUserIds, jobsUpdatedAt,
  } = useDashboardData();

  // Sentinel for infinite scroll (see useLoadMoreSentinel).
  const loadMoreRef = useLoadMoreSentinel({
    hasNextPage, isFetchingNextPage, fetchNextPage, itemCount: allJobs.length,
  });

  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: refresh,
  });

  useRealtimePush(user?.id ?? null);
  // Guest bookmark -> signup -> this saves the job they wanted kept.
  usePendingSaveConsumer(user?.id);
  // Warm Referral / Activity / Jobs caches in the background — makes the next tap feel instant.
  usePrefetchUserData(user?.id);

  // Saved / dismissed job-id state, and the "Only saved jobs" lens.
  //
  // Saving a job used to have no destination at all — the bookmark on every
  // card wrote to a list nobody could open (owner: "how can they see saved
  // jobs?").
  //
  // Declared HERE, ahead of useDashboardFilters, because every one of these
  // is a viewer-local cull the LIST, the HEADER COUNT and the MAP must apply
  // identically. `savedOnly` is a filter on the feed rather than a separate
  // screen: a saved job is still a job you might apply to, so it belongs in
  // the surface that knows how to apply to it. Not persisted — a lens you
  // look through and step back out of, not a layout preference.
  const {
    savedJobIds, setSavedJobIds, dismissedJobIds, setDismissedJobIds, savedRead,
  } = useDashboardSideQueries({ userId: user?.id, allJobs });
  const [savedOnly, setSavedOnly] = useState(false);
  // A phone's open search takes the tabs row beside the selected tab, which stays whole (tester T10, 10-30).
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);
  const toggleSavedOnly = useCallback(() => setSavedOnly((v) => !v), []);
  const { quotesOn, wantsQuotes, toggleWantsQuotes, showAllJobs } = useWantsQuotes();

  /**
   * ONE object, three surfaces. See src/pages/home/viewerFeedExclusions.ts.
   *
   * The list, the header count and the map each build their set from a
   * different source (a paginated view read, a `count: exact` query, and the
   * map RPC), and every divergence the owner has reported on this screen has
   * been a cull that reached one of them and not the others — applied jobs on
   * 2026-09-15, dismissed jobs on 2026-09-19 ("map shows 7 jobs. list shows
   * 4"). Passing the whole object rather than a prop per rule is what keeps
   * the next one from repeating it.
   */
  const exclusions = useMemo<ViewerFeedExclusions>(() => ({
    appliedJobIds,
    blockedUserIds,
    dismissedJobIds,
    // null = the toggle is off. An EMPTY set (toggle on, nothing saved) is a
    // real answer — zero matches — and must not collapse into "no filter".
    savedOnlyJobIds: savedOnly ? savedJobIds : null,
  }), [appliedJobIds, blockedUserIds, dismissedJobIds, savedOnly, savedJobIds]);

  const filters = useDashboardFilters({
    allJobs, userId: user?.id, profile, helprTier, helperAvailability: helperAvailability as HelperAvailabilitySlot[],
    // Same rate the feed cards render with (`effectiveFee` below is this
    // value) — the pay sorts have to order by the number on the card.
    effectiveFee: platformFee,
    // Threaded into the header count so it excludes what the feed hides (B1), and into `filteredJobs`
    // so the list, the count and the map share the exclusions (2026-09-19); savedJobIds: the bookmark count (Q1739).
    appliedJobIds, blockedUserIds, dismissedJobIds, savedJobIds,
    savedOnlyJobIds: exclusions.savedOnlyJobIds,
  });

  // The header's "N jobs": with every page loaded the list IS the set, never a server total (owner, 2026-10-05; headerJobCount.ts).
  // The filter sheet's "Show N jobs" uses sheetResultCount (board 24): no number unless it is exact.
  const headerCount = headerJobCount({
    serverCount: filters.totalMatchingCount,
    listedCount: filters.filteredJobs.length,
    listComplete: !hasNextPage,
  });
  useSavedOnlyPaging({ savedOnly, listedCount: filters.filteredJobs.length, serverCount: filters.totalMatchingCount, hasNextPage, isFetchingNextPage, fetchNextPage });

  // The greeting card's "stat of the day" line was removed — it added a
  // third line to the title card and pushed the job feed down. The
  // headline job count it surfaced still shows in the date eyebrow.

  // Stripe's boost return (`/home?boosted=<jobId>`): told only to the job's poster.
  useBoostReturn({ userId: user?.id, searchParams, setSearchParams, navigate });

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  // The birthday greeting no longer waits on an onboarding tour here: the first run (board 53) lives on Home.
  // Detail-dialog open/close lifecycle (which job, feed-scroll restore, and
  // ?job=<id> URL mirroring) lives in useDetailJob.
  const { detailJob, openDetailJob, closeDetailJob } = useDetailJob({
    containerRef, searchParams, setSearchParams, allJobs,
  });
  // Drop `?quickApply` once the deep link has resolved. Functional + replace:
  // it reads `prev` rather than the captured `searchParams`, and adds no history
  // entry. It is NOT a stable reference: react-router 7's `setSearchParams` is a
  // useCallback over `[navigate, searchParams]`, so this changes identity on
  // every query-string change. It never re-fires QuickApplyHandler's effect only
  // because that component reads `onHandled` through a ref, not a dep.
  const clearQuickApplyParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("quickApply");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // List vs Map view. The map shows the same open jobs as the list,
  // pinned to neighborhood-rounded coords (privacy via the
  // get_open_jobs_for_map RPC). Toggle persists for the session only —
  // resetting to "list" on next mount matches user expectation that
  // the default landing surface is the curated feed.
  const [view, setView] = usePersistedBrowseView("list");

  // Web desktop (≥1024px, non-native) composes the feed and the map
  // side by side, so the list/map toggle is meaningless there and the
  // feed is locked to "list" — the map always occupies its own column.
  const isWebDesktop = useIsWebDesktop();

  /* The hand-back itself. Keyed on the open flag so it runs AFTER the commit
     that re-mounts the trigger — the button does not exist yet at the moment
     the ✕'s click handler runs — and only on a true->false transition, so it
     can never steal focus on first paint. Guarded on `isWebDesktop` because
     on phone the field lives in the title card and DashboardTitleBar already
     owns that row's hand-back; running both would fight over the caret. */
  useEffect(() => {
    if (isWebDesktop && hadDesktopSearchRef.current && !filters.searchOpen) {
      desktopStripRef.current
        ?.querySelector<HTMLElement>("[data-search-trigger]")
        ?.focus();
    }
    hadDesktopSearchRef.current = isWebDesktop && filters.searchOpen;
  }, [filters.searchOpen, isWebDesktop]);

  // Feed density — comfortable (full cards) or compact (48px rows). Read from
  // any persisted preference; the in-toolbar toggle was removed for a cleaner
  // Browse Tasks header, so this is now read-only (defaults to comfortable).
  const [density] = useState<FeedDensity>(readStoredFeedDensity);

  /**
   * Is the map column showing? Desktop website only.
   *
   * The map is a second way to read the same board, not a required half of the
   * screen — a helpr who knows their parish wants the list at full width
   * (owner: "give them the option to get rid of the map"). Persisted, because a
   * pane that reappears on every route change is one the user has to dismiss
   * repeatedly. Default ON: the split view is the desktop layout, and a map
   * nobody has been told exists is worse than one they can close. Own key since
   * 2026-10-30 (src/lib/jobsMapVisible.ts): a device that hid it once sees it again.
   */
  const [mapVisible, setMapVisible] = useState<boolean>(readJobsMapVisible);

  // ONE OUTAGE, ONE MESSAGE — the same rule f2b63d921 applied to the
  // notification toast, now applied to the desktop map column.
  //
  // The feed and the map each legitimately own their own read, and each
  // renders a designed ErrorState when that read fails. At 1440 they sit side
  // by side, so a single backend outage painted TWO cards — "We couldn't load
  // jobs." at x 93 and "We couldn't load the map." at x 663, two warning
  // triangles, two Try again buttons — for one failure with one cause and one
  // remedy. (Measured at 1440 with every non-account read 500ing.)
  //
  // This is the EXACT condition BrowseTasksFeed uses to paint its own card
  // (`loadError && allJobs.length === 0`), so the two can't disagree: when the
  // feed is already saying it, the map column doesn't repeat it, and the one
  // card spans the panel. Both surfaces read the same jobs, so the feed's
  // "Try again" is the map's retry too. The moment the feed has rows again the
  // column comes back — `mapVisible` is untouched, so the user's choice
  // survives the outage.
  // Offline (or paused) with no page in hand is the same: one card, never "0" or the empty state (owner 10-31).
  const feedOfflineEmpty = feedPhase === "offline-empty";
  const feedShowingLoadError = (Boolean(loadError) || feedOfflineEmpty) && allJobs.length === 0;
  // The storage write is OUTSIDE the updater on purpose. React's StrictMode
  // invokes a state updater twice in development to surface exactly this: with
  // the setItem inside, the first call stored "0" and the second — re-run
  // against the already-flipped value — stored "1" again, so the button
  // appeared to do nothing at all.
  const toggleMap = useCallback(() => {
    const next = !mapVisible;
    setMapVisible(next);
    saveJobsMapVisible(next);
  }, [mapVisible]);

  // Desktop split-screen hover sync — hovering a list card scales up the
  // corresponding map pin. null = no card hovered.
  const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);

  // Profile-completion is no longer nudged on the home feed — the full
  // "Finish your profile" card pushed the job feed below the fold. The
  // completion checklist / progress meter lives on the Profile landing
  // screen instead (ProfileLanding's completion meter), which is the
  // surface the user navigates to in order to act on it.

  const effectiveFee = platformFee;

  const { handleToggleSave } = useSaveJob({ user, savedJobIds, setSavedJobIds });

  const {
    confirmApplyJobId, setConfirmApplyJobId, confirmApplyJob,
    applyMessage, setApplyMessage, applyLoading, applyFiles, setApplyFiles,
    applyTimeSuggestion, setApplyTimeSuggestion,
    handleApplyRequest, handleApplyConfirm,
    applicationSent, closeApplicationSent, viewApplication,
  } = useApplyFlow({ user, allJobs });

  // Immediate optimistic dismiss + toast/Undo (owner: the "Not Interested?"
  // confirm dialog was a whole modal for a reversible, purely-local action —
  // same mismatch as the attachment-remove undo in AppliedJobsTab). The job
  // drops off the feed right away; Undo puts the id back in storage + state.
  const handleDismissRequest = useCallback((jobId: string) => {
    setDismissedJobIds(prev => {
      const next = new Set(prev);
      next.add(jobId);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
      return next;
    });
    toast.success("Job removed from your feed", {
      action: {
        label: "Undo",
        onClick: () => {
          setDismissedJobIds(prev => {
            const next = new Set(prev);
            next.delete(jobId);
            safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
            return next;
          });
        },
      },
    });
  }, [setDismissedJobIds]);

  // The in-progress pill is no longer rendered in the brand row (owner:
  // "remove"). That row is logo, filter, notification. The job it pointed at is
  // still one tap away via the Jobs tab, and DashboardInProgressBadge itself
  // stays — ScheduleTab imports `inProgressBadgeTarget` from it.


  /* On the desktop website Browse's search, filters and map ride at the END OF THE TABS ROW and its count sits
     beside "Browse" (owner 2026-10-28: "move the 1 next to browse and the search filter and map up onto the
     other line above to save space"). The search still opens in place, leftward, out of the cluster. */
  const desktopBrowseEnd = isWebDesktop ? (
    <div ref={desktopStripRef} data-feed-strip="" className="flex items-center gap-1 shrink-0 pb-0.5">
      {filters.searchOpen && (
        <BrowseSearchBar filters={filters} className="ml-auto" />
      )}
      <div className={`flex items-center gap-1 ${filters.searchOpen ? "" : "ml-auto"}`}>
        <BrowseTasksActions
          filters={filters}
          filtersButtonRef={filtersButtonRef}
          savedOnly={savedOnly}
          onToggleSavedOnly={toggleSavedOnly}
          savedCount={filters.savedShownCount ?? 0}
        />
        {/* Show / hide the map column (shared with Declutter's Browse). Disabled while the feed shows its
            load-error card: the map column is suppressed then (`feedShowingLoadError`). */}
        <MapToggleButton visible={mapVisible} onToggle={toggleMap} disabled={feedShowingLoadError} />
      </div>
    </div>
  ) : undefined;

  /* Phone: search + filters end the tabs row, before the gear (owner 2026-10-28). Guard: jobsSearchIsAnIcon.test.tsx */
  const phoneBrowseEnd = isWebDesktop ? undefined : (<div data-browse-phone-controls="" className={`flex items-center gap-0 self-center ${phoneSearchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"}`}>
      <InlineListSearch value={filters.searchQuery} onChange={filters.setSearchQuery} label="Search jobs" onOpenChange={setPhoneSearchOpen} fill />
      {phoneSearchOpen && <SearchTriggerSlot width="40px" />}
      <BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />
    </div>);

  const embeddedTitle = (
    <div className="flex flex-col gap-4">
      {embeddedHeader(isWebDesktop ? { end: desktopBrowseEnd, count: wantsQuotes || feedShowingLoadError ? undefined : headerCount } : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })}
    </div>
  );

  if (loading) {
    // Loading mirrors the exact loaded layout (same PageScaffold, the REAL title bar) so the feed
    // settles in place instead of shoving everything down.
    return (
      <PageScaffold
        animate
        panelElevation="raised"
        // Full-bleed app bar: web-desktop ONLY (on phone it would stack a second sticky header).
        // SAME FRAME AS THE LOADED DESKTOP PAGE (Q169): no title card, feed + map columns, so the
        // panel no longer jumps 42px when the feed lands (CLS 0.045 at 1440).
        titleCard={embeddedTitle}
        titleCardClassName=""
      >
        {/* The screen's one <h1> is the section top bar's ("Jobs", in the title card above); this only
            announces the wait. */}
        <p className="sr-only" role="status" aria-live="polite">Loading jobs near you…</p>
        {isWebDesktop ? (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="dashboard-desktop-loading">
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                <DashboardSkeleton />
              </div>
              {mapVisible && (
                <div
                  className="w-[48%] shrink-0 min-h-0"
                  style={{ borderLeft: "1px solid hsl(var(--olivewood) / 0.12)" }}
                  aria-hidden
                />
              )}
            </div>
          </div>
        ) : (
          <DashboardSkeleton />
        )}
      </PageScaffold>
    );
  }

  // Prefer the profile's stored full name, then auth metadata, then the email
  // local-part — never fall back to the literal word "User" in greetings.
  const rawName =
    (profile?.full_name && profile.full_name.trim()) ||
    (user?.user_metadata?.full_name && String(user.user_metadata.full_name).trim()) ||
    (user?.user_metadata?.name && String(user.user_metadata.name).trim()) ||
    "";
  const emailLocal = user?.email ? user.email.split("@")[0] : "";
  const firstName = (rawName || emailLocal || "there").split(" ")[0];
  const banStatus = profile?.ban_status || "active";

  // Block banned users
  if (!isAdmin && (banStatus === "permanently_banned" || banStatus === "temp_banned")) {
    return <DashboardBannedScreen banStatus={banStatus} />;
  }

  // No approval states (Q193, owner 2026-09-23): every signup is
  // auto-approved and bans are automated, so the "profile not approved" stop
  // screen and the "verification in progress" banner that sent pending users
  // to /account-pending are gone. Verification still gates the moments that
  // need it (IDV-before-accept in Activity.tsx, payout setup).

  // The apply step's fields, the same for the detail sheet's ApplyBody and the ApplyConfirmDialog.
  const applyFieldProps = { platformFee, applyMessage, setApplyMessage, applyTimeSuggestion, setApplyTimeSuggestion, applyFiles, setApplyFiles, applyLoading };

  return (
    <>
    <PageScaffold
      animate
      panelElevation="raised"
      // The section's top bar + tabs (+ the compact search row on phone). On the desktop website the search +
      // filter controls live INSIDE the panel, directly above the job cards (the feed strip below), so the screen
      // reads as one box.
      titleCard={embeddedTitle}
      titleCardClassName=""
      beforePanel={
        <>
          {/* The "Your Helprs" quick-rebook strip used to render here,
              wrapped in a SectionBoundary. Removed 2026-08-19 at the owner's
              request — it pushed the job feed down on the home tab for a
              shortcut that only pays off for repeat customers. Rebooking a
              saved helper still lives on Profile -> Saved Helprs, which is
              where the full list is. The component was kept unrendered for a
              while in case it returned; it was deleted on 2026-08-25 in the
              dead-code sweep and is recoverable from git history. */}
          {/* The "Finish your profile" completion nudge used to render
              here. It moved off the home feed onto the Profile landing
              screen (ProfileLanding's completion meter) so the job feed
              is no longer pushed below the fold. */}

          
          {/* Promo/nudge banner slot intentionally empty — the home screen
              shows the greeting, the saved-helpers row, "For you", and the
              job feed with no marketing/upsell cards in between. */}
        </>
      }
    >
            {/* The standalone "For you" carousel was removed: it duplicated
                the job feed (same jobs as Browse at low inventory) and ate a
                whole horizontal band. Personalization now lives in the single
                Browse feed as ORDER — the "Picked for you" group surfaces
                relevance-ranked jobs at the top, then "Everything else". One
                clean, personalized, vertical list; no duplication. */}

            {/* Browse-tasks feed is the main scroll surface of the
                dashboard. Wrap so a render error in any job card (rare,
                but cheap insurance) shows an inline retry banner inside
                the panel rather than blanking the entire route. The
                page-level ErrorBoundary above still catches anything
                that escapes this. */}
            <SectionBoundary label="the job feed">
              {/* The job feed fills the frame. The map is reached via the
                  toolbar list/map toggle (BrowseMap inside BrowseTasksFeed),
                  not a side panel — a fixed split-screen map clipped at the
                  edge of the centered phone-width frame. */}
              {/* The feed's own controls (owner: "add section above just the job cards like it's their own box"),
                  now the SAME row as Posted / Working's status chip row (owner, 2026-10-27: "0 jobs and the line
                  under should be the same size as the posted screen"): one 46px row with no side inset, and its
                  hairline across the whole panel, over the list and the map, as Posted's spans. jobsToolbar.ts. */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                  <BrowseTasksToolbar
                    screenName="Jobs"
                    // The section's top bar carries the screen's one <h1> ("Jobs"); a second, sr-only one here
                    // made two (Q2205, home-chrome.spec.ts h1Count).
                    renderHeading={false}
                    filtersAnchorRef={filtersButtonRef}
                    titleSrOnly
                    filters={filters}
                    user={user}
                    helperAvailability={helperAvailability}
                    view={view}
                    setView={setView}
                    hideViewToggle={isWebDesktop}
                    // NO `compactActions`. That flag grew a second Search
                    // field inside the filter sheet for exactly the surfaces
                    // whose header row had lost the search icon — and the
                    // header row has it back on every width now, so passing it
                    // would put two search fields on one screen. "Only saved
                    // jobs" is unaffected: it comes from
                    // buildJobFilterSections, not from this flag.
                    savedOnly={savedOnly}
                    onToggleSavedOnly={toggleSavedOnly}
                    savedCount={filters.savedShownCount ?? 0}
                    wantsQuotes={wantsQuotes}
                    onToggleWantsQuotes={quotesOn ? toggleWantsQuotes : undefined}
                    resultCount={sheetResultCount({ listedCount: filters.filteredJobs.length, listComplete: !hasNextPage, listOnScreen: !wantsQuotes && !feedShowingLoadError && (isWebDesktop || view === "list") })}
                    onClearAllFilters={() => scrollFeedToTop(containerRef.current)}
                  />

                  <WantsQuotesSlot active={wantsQuotes} onShowAllJobs={showAllJobs}>
                  <BrowseTasksFeed
                    view={isWebDesktop ? "list" : view}
                    density={density}
                    filters={filters}
                    user={user}
                    allJobs={allJobs}
                    loadError={loadError}
                    offline={feedOfflineEmpty}
                    refresh={refresh}
                    recommendedJobs={recommendedJobs}
                    // Reserve the "Picked for you" slot with skeletons only while a
                    // pull-to-refresh re-derives recommendations and no picks exist
                    // yet, so the empty→filled swap doesn't shove the list down (CLS).
                    // NOT keyed on isFetchingNextPage: the recommended section belongs
                    // to the first page only, so infinite-scroll pagination would
                    // otherwise flash two placeholder cards at the top of the feed
                    // every time the next page loads with zero recommendations.
                    recommendedLoading={refreshing}
                    savedOnly={savedOnly} savedRead={savedRead}
                    effectiveFee={effectiveFee}
                    handleApplyRequest={handleApplyRequest}
                    handleDismissRequest={handleDismissRequest}
                    handleToggleSave={handleToggleSave}
                    expandedCardId={expandedCardId}
                    setExpandedCardId={setExpandedCardId}
                    savedJobIds={savedJobIds}
                    setReportJobId={setReportJobId}
                    setDetailJob={openDetailJob}
                    containerRef={containerRef}
                    pullDistance={pullDistance}
                    refreshing={refreshing}
                    isPulling={isPulling}
                    canTrigger={canTrigger}
                    loadMoreRef={loadMoreRef}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                    hoveredJobId={hoveredJobId}
                    setHoveredJobId={setHoveredJobId}
                    exclusions={exclusions}
                    mapRefreshKey={jobsUpdatedAt}
                  />
                  </WantsQuotesSlot>
                </div>
                {/* Web-desktop only: the map rides alongside the feed in its
                    own column rather than hiding behind a toggle. The page
                    frame is full-width here (PageScaffold desktop), so the
                    map has real room and doesn't clip at a phone-width edge
                    the way the old side-map did (#12). */}
                {isWebDesktop && mapVisible && !feedShowingLoadError && !wantsQuotes && (
                  <div
                    className="w-[48%] shrink-0 min-h-0 flex flex-col"
                    style={{ borderLeft: "1px solid hsl(var(--olivewood) / 0.12)" }}
                  >
                    <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
                      <BrowseMap
                        flush
                        // Same job-detail dialog the feed's cards open on
                        // tap (openDetailJob), not the quick-apply sheet —
                        // see the matching note in BrowseTasksFeed.tsx.
                        //
                        // VN-10: this was `allJobs.find(...)` alone, so a pin
                        // for a job this page had not loaded (or had filtered
                        // out — own posts, past-dated, already applied) was a
                        // dead tap. Measured on prod at 1440, 2026-09-14:
                        // "Pressure wash a driveway and patio" was pinned,
                        // absent from the list, and its card did nothing.
                        // `openJobFromPin` is the one lookup both maps use.
                        onJobAction={(jobId) =>
                          openJobFromPin({
                            jobId,
                            lists: [filters.filteredJobs, allJobs],
                            open: openDetailJob,
                            onError: (m) => toast.error(m),
                          })
                        }
                        currentUserId={user?.id}
                        filters={filters.mapFilter}
                        onClearFilters={filters.clearFilters}
                        // MUST match the feed column beside it. Without this
                        // prop BrowseMap falls back to guest pricing and the
                        // pin preview prints the GROSS budget, so on this exact
                        // screen "Pressure wash a house exterior" read $368 in
                        // the list and $400 on the map, side by side, for the
                        // same job (caught 2026-08-31 at 1440). Same value the
                        // list's JobCards use — one number per job, everywhere.
                        effectiveFee={effectiveFee}
                        // Every viewer-local cull the feed applies — applied,
                        // dismissed, "Only saved" — so the pins, the cards and
                        // the header count describe ONE set. Optimistic apply
                        // and dismiss both update it, so a pin vanishes the
                        // moment the card does.
                        exclusions={exclusions}
                        // Re-read the pins whenever the list re-reads, so the
                        // map never shows a board older than the list beside it.
                        refreshKey={jobsUpdatedAt}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
            </SectionBoundary>

    </PageScaffold>

      {/* Dialog chunks load on demand — only mounted once the user opens
          them, so the Dashboard route chunk doesn't carry them. */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            job={detailJob}
            effectiveFee={effectiveFee}
            allJobs={allJobs}
            isSaved={detailJob ? savedJobIds.has(detailJob.id) : false}
            onToggleSave={handleToggleSave}
            userLat={filters.userLoc?.status === "ready" ? filters.userLoc.lat : null}
            userLng={filters.userLoc?.status === "ready" ? filters.userLoc.lng : null}
            /* Dismissing the sheet abandons the apply too. Without clearing
               the pending id, closing from the apply step left
               confirmApplyJobId set with no detail sheet to host it — and the
               standalone deep-link sheet below (which renders whenever that id
               is set and does NOT match an open detail job) would immediately
               pop the apply form back up on the bare feed. */
            onClose={() => { setConfirmApplyJobId(null); closeDetailJob(); }}
            onApply={handleApplyRequest}
            onReport={setReportJobId}
            onSelect={openDetailJob}
            /* THE APPLY FORM, ON THIS SAME SHEET — NO SECOND STEP.
               Applying was a separate centred AlertDialog, then the second
               STEP of this sheet, and is now simply part of it (owner,
               2026-09-09: "collapse the TWO steps into ONE ... one less tap
               to apply"). useApplyFlow still owns the mutation; only where
               the markup mounts and when the guards run has changed.

               WITHHELD ON YOUR OWN POST, synchronously. `user` is available
               here without a round trip, while the sheet's own `viewerUserId`
               resolves a beat after open — so deciding it here is what stops
               a poster seeing an apply form flash on their own job. The sheet
               falls back to the footer, which says "This is your post".

               THE GUARDS MOVED TO THE SUBMIT. `handleApplyRequest` (offline,
               impersonation, signed out, own post) used to run on the
               Continue tap. There is no Continue, so it runs on Apply Now,
               immediately before the mutation — same guards, same refusals,
               one tap later. */
            /* NO <Suspense> OF ITS OWN — IT SHARES THE SHEET'S, ON PURPOSE.
               ApplyBody is a separate lazy chunk. Wrapped in its own
               `<Suspense fallback={null}>`, the sheet painted WITHOUT its apply
               form and then INSERTED ~340px of it when the chunk landed. The
               sheet is centred and content-sized, so that insertion moved both
               edges: measured on the production bundle at 375x812, 4x CPU
               throttling, 400kbps/400ms link, the top edge sat still at y=227.5
               for a full second and then jumped to y=56.8 — 170.7px in ONE
               frame, on a surface the reader was already reading. That is the
               "very jumpy on open then settles" reported from TestFlight
               1.0.4/7110, and it was the largest contributor by an order of
               magnitude (next was 28.9px, and only on a credential-gated job).

               Dropping the inner boundary lets the suspension bubble to the
               sheet's own <Suspense> just below — the one already withholding
               JobDetailDialog's chunk. Both lazy imports start in the same
               commit, so the sheet waits for max(dialog, form) instead of
               painting at dialog and reflowing at form: one paint, final
               height, nothing moves. Not a skeleton and not a delay — it is
               refusing to split ONE surface across two paints. Do not
               "optimise" this back into a boundary of its own. */
            applyForm={
              detailJob.customer_id !== user?.id ? (
                <ApplyBody
                  open
                  onClose={() => setConfirmApplyJobId(null)}
                  confirmApplyJob={detailJob}
                  {...applyFieldProps}
                  hideEarnings
                  handleApplyConfirm={async () => {
                    const accepted = await handleApplyRequest(detailJob.id);
                    if (accepted === false) return;
                    // Submitting takes the whole sheet down — the helpr is
                    // done with this job either way, and the success toast
                    // is the confirmation. The id is passed explicitly:
                    // handleApplyRequest set it in state one tick ago and
                    // this render cannot see it yet.
                    handleApplyConfirm(detailJob.id);
                    closeDetailJob();
                  }}
                />
              ) : null
            }
          />
        </Suspense>
      )}

      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />
        </Suspense>
      )}

      {/* Birthday greeting — a popup, not chrome. It used to be mounted as a
          sibling of the (now removed) app bar inside PageScaffold's `header`
          slot; it lives with the other overlays now. Still mounted on every
          Dashboard render — it self-hides unless today is the user's birthday. */}
      <Suspense fallback={null}>
        <BirthdayPopup
          dateOfBirth={profile?.date_of_birth}
          firstName={firstName}
          deferred={false}
        />
      </Suspense>

      {/* A job-match notification opens THE JOB SHEET, not a toast (owner,
          2026-09-11). `openDetailJob` is the exact same entry point a tap on
          a feed card uses — it snapshots the feed scroll and mirrors `?job=`
          — so the deep link and the card converge on one surface. The
          `quickApply` param is then dropped with a functional REPLACE, which
          is what keeps this off the replaceState-throttle path: one write, no
          `setSearchParams` loop, and Back can't re-fire the link. */}
      <QuickApplyHandler
        searchParams={searchParams}
        user={user}
        allJobs={allJobs}
        onOpenJob={openDetailJob}
        onHandled={clearQuickApplyParam}
      />


      {/* STANDALONE apply sheet — only for the QuickApply deep link
          (`?apply=<jobId>`), where no detail sheet is open to host the step.
          When the detail sheet IS open it renders the apply step itself, and
          mounting this too would stack a second surface over it. */}
      <ApplicationSentDialog sent={applicationSent} onClose={closeApplicationSent} onView={viewApplication} platformFee={platformFee} />
      {confirmApplyJobId && confirmApplyJobId !== detailJob?.id && (
        <Suspense fallback={null}>
          <ApplyConfirmDialog
            open={!!confirmApplyJobId}
            onClose={() => setConfirmApplyJobId(null)}
            confirmApplyJob={confirmApplyJob}
            {...applyFieldProps}
            handleApplyConfirm={handleApplyConfirm}
          />
        </Suspense>
      )}

      {/* No payout-setup dialog here. It was mounted behind a
          `payoutSetupDialogOpen` flag whose setter was never called from
          anywhere, so it could not open — a lazy chunk and a piece of state
          maintained for a dialog no user could ever see.

          Nor should it open here: applying to a job does not require a payout
          account, accepting one does, and that gate already exists in
          useOfferHandlers (with a "Set up payouts" action on the toast). Adding
          a second gate at apply time would put the friction at the wrong
          moment. This was PayoutSetupDialog's only mount point, so the
          component had no reachable caller at all and is deleted with it. */}

      {/* Floating-FAB removed — MobileNav already renders a Post FAB at the
          right edge of the bottom dock. Two FABs at the same screen corner
          was the "stacked plus buttons" bug visible in TestFlight build
          screenshots. Desktop surfaces the CTA in the header (md:flex)
          so no desktop replacement is needed. */}

    </>
  );
};

export default Dashboard;
