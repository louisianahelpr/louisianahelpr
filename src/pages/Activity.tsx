import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useActivityData } from "@/hooks/useActivityData";
import { ActivityDialogs } from "@/components/activity/ActivityDialogs";
import { type Tab } from "@/components/activity/activityConstants";

// Tab content is lazy-split so the initial Activity chunk only contains the
// shell (header, filters, skeleton fallbacks). The per-tab bundles are fetched
// once the data is ready and the correct tab is about to be rendered.
const PostedJobsTab = lazy(() =>
  import("@/components/activity/PostedJobsTab").then((m) => ({ default: m.PostedJobsTab })),
);
const AppliedJobsTab = lazy(() =>
  import("@/components/activity/AppliedJobsTab").then((m) => ({ default: m.AppliedJobsTab })),
);

// These dialogs are conditionally mounted (only when the user triggers an
// action), so lazy-loading them avoids including their subtrees in the
// initial chunk entirely.
const IDVPromptDialog = lazy(() =>
  import("@/components/IDVPromptDialog").then((m) => ({ default: m.IDVPromptDialog })),
);
const W9CollectionDialog = lazy(() => import("@/components/W9CollectionDialog"));
import { useActivityActions } from "@/pages/activity/useActivityActions";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  useActivityFilters,
} from "@/pages/activity/activityFilters";
import { ActivityHeader } from "@/pages/activity/ActivityHeader";
import { ActivityEmptyState } from "@/pages/activity/ActivityEmptyState";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import SectionBoundary from "@/components/SectionBoundary";
import { defaultStatusFilterFor } from "@/components/activity/activityConstants";

const Activity = ({ defaultTab = "posted" }: { defaultTab?: "posted" | "applied" }) => {
  usePageTitle(defaultTab === "posted" ? "My Posts — Helpr" : "My Jobs — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCurrentUser();
  const tab = defaultTab as Tab;
  // My Posts opens on "Active" — a flat list of every non-terminal task
  // (open / accepted / in_progress / …). Completed and Cancelled remain
  // reachable via the status filter.
  //
  // My Jobs opens on "All", which renders the grouped ACTIVE / COMPLETED /
  // CLOSED view.
  //
  // It used to open on "pending" — a SINGLE status, not a bucket — which made
  // the two tabs asymmetric: My Posts got a broad default, My Jobs got a
  // narrow one. The moment every application had been answered, the helper
  // landed on "No jobs in this view. Try a different filter", and their whole
  // history was invisible until they found the filter menu and changed it
  // themselves. Observed on a real account with four applications: the filter
  // menu read "All 4 … Applied (none) … Not Selected 4", i.e. the page had
  // four things to show and chose the one bucket that was empty.
  //
  // "All" is the only broad option on this tab (there is no "active" bucket
  // for applications), and its grouped view already puts live applications in
  // the ACTIVE section above the settled ones — so pending work still leads.
  const defaultFilter = defaultStatusFilterFor(defaultTab);
  // Filter + search seed from URL params so a deep link (or browser
  // back/forward) lands the user on the exact view they had. We keep the
  // local-state mirror because the dropdown/search inputs need a
  // controlled value, and writing to the URL inside an onChange handler
  // is too coarse for typing latency.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [searchOpen, setSearchOpen] = useState(() => !!searchParams.get("q"));
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    return searchParams.get("filter") ?? defaultFilter;
  });

  // Deep-link highlight — the notification for "poster viewed your
  // application" links to /my-jobs?highlight=<applicationId>. We read
  // it once on mount, hand it to AppliedJobsTab so the matching card
  // can scroll into view + pulse, then strip it from the URL (replace,
  // not push) so Back doesn't re-trigger the animation.
  const [highlightAppId] = useState<string | null>(() =>
    defaultTab === "applied" ? (searchParams.get("highlight") ?? null) : null,
  );

  // Remove ?highlight= from the URL after the first paint. We do this
  // in a microtask so the param is still present when the tab mounts
  // and reads it; by the time the Effect fires the card scroll has
  // already been requested.
  useEffect(() => {
    if (!highlightAppId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("highlight");
    setSearchParams(next, { replace: true });
    // Run once on mount — highlightAppId is stable (useState initial value).
  }, []);

  // Push filter/search changes back into the URL so navigating away and
  // back (or browser back/forward) restores the view. Skip the write
  // when the value is already the URL default to avoid noisy history
  // entries on first load.
  useEffect(() => {
    const current = new URLSearchParams(searchParams);
    let changed = false;
    if (statusFilter === defaultFilter) {
      if (current.has("filter")) { current.delete("filter"); changed = true; }
    } else if (current.get("filter") !== statusFilter) {
      current.set("filter", statusFilter);
      changed = true;
    }
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      if (current.has("q")) { current.delete("q"); changed = true; }
    } else if (current.get("q") !== trimmedQuery) {
      current.set("q", trimmedQuery);
      changed = true;
    }
    if (changed) setSearchParams(current, { replace: true });
    // setSearchParams is stable; deps intentionally exclude searchParams
    // to prevent the loop that would form if the effect listened to
    // its own write.
  }, [statusFilter, searchQuery, defaultFilter, searchParams, setSearchParams]);

  // Sync filter when URL search params change externally (e.g. navigating
  // from a notification or via browser back/forward — not from our own
  // write above, which already matches local state).
  //
  // We read the latest local filter/query through refs rather than listing
  // them as effect deps. If they were deps, this effect would also fire on
  // a *local* selection — at which point `searchParams` is still the
  // pre-write value (the Effect above's `setSearchParams` hasn't committed
  // a re-render yet), so it would read "no filter" and clobber the
  // just-applied selection back to the default. Depending only on the URL
  // means this runs solely for genuine external navigation.
  const statusFilterRef = useRef(statusFilter);
  const searchQueryRef = useRef(searchQuery);
  statusFilterRef.current = statusFilter;
  searchQueryRef.current = searchQuery;
  useEffect(() => {
    const paramFilter = searchParams.get("filter") ?? defaultFilter;
    if (paramFilter !== statusFilterRef.current) setStatusFilter(paramFilter);
    const paramQuery = searchParams.get("q") ?? "";
    if (paramQuery !== searchQueryRef.current.trim()) {
      setSearchQuery(paramQuery);
      if (paramQuery) setSearchOpen(true);
    }
  }, [searchParams, defaultFilter]);

  const {
    loading, loadError, postedJobs, appliedApps, applicantCounts,
    startRequestedJobIds, helperNames, completedJobMeta,
    helperReviewedJobIds, latestTracking, groupHelpersByJob, refresh,
  } = useActivityData(user);

  // Customer-first-bid push nudge — fires the high-intent re-ask the
  // first time this customer sees at least one applicant on a job they
  // posted. `applicantCounts` is keyed by job id and populated by
  // useActivityData on every fetch (including the realtime-driven
  // invalidations), so the moment a bid lands we're in here. The hook
  // self-suppresses on already-granted, already-shown, or
  // recently-dismissed — so this effect is safe to fire on every load.
  const triggerPushNudge = usePushPermissionNudge();
  useEffect(() => {
    if (!user) return;
    const hasAnyBid = Object.values(applicantCounts).some((n) => n > 0);
    if (!hasAnyBid) return;
    void triggerPushNudge("customer-first-bid");
  }, [user, applicantCounts, triggerPushNudge]);

  // Data-loading + action handlers + dialog/UI state (extracted hook).
  const actions = useActivityActions({
    user,
    postedJobs,
    appliedApps,
    refresh,
    setStatusFilter,
    helperNames,
    completedJobMeta,
  });

  // Status-filter definitions + memoized list/count derivations.
  const { filteredPostedJobs, filteredAppliedApps, appliedCounts, postedCounts } =
    useActivityFilters({
      postedJobs,
      appliedApps,
      statusFilter,
      searchQuery,
      userId: user?.id,
    });

  // Pull-to-refresh — per-tab refresh wrapper. The underlying
  // useActivityData query is a single key covering both posted and
  // applied data (server-side join economy), so a refetch hits both;
  // but each Activity instance ("/my-posts" vs "/my-jobs") tracks its
  // own pull-state and its own "last refreshed at" timestamp so the
  // tabs feel independent and one tab's stale-while-revalidating
  // refresh doesn't visually leak into the other.
  const lastRefreshKey = `activity:lastRefresh:${tab}`;
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(lastRefreshKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  });
  const tabRefresh = useCallback(async () => {
    await refresh();
    const now = Date.now();
    setLastRefreshedAt(now);
    try { sessionStorage.setItem(lastRefreshKey, String(now)); } catch { /* private mode */ }
  }, [refresh, lastRefreshKey]);
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: tabRefresh,
  });

  // On a status-filter change the filtered list shrinks/changes, but the
  // internal scroll container keeps its old offset — landing the user
  // mid-list on results that should start at the top. Reset to the top so
  // the new filter reads from row one.
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [statusFilter, containerRef]);

  if (loading) {
    // Loading state mirrors the loaded layout: two-box stack on a
    // bg-premium-page shell with skeleton cards inside the bottom box.
    return (
      <PageScaffold
        header={<DashboardHeader titleAs="h1" title={tab === "posted" ? "My Posts" : "My Jobs"} />}
        titleCard={<Skeleton className="h-3 w-44 rounded" />}
      >
        <div className="px-4 pt-3 space-y-2.5">
          {/* On the "applied" tab use the application-card-shaped skeleton
              so the loading→loaded swap doesn't visibly thump (see #121).
              The "posted" tab keeps the original generic ActivityCardSkeleton
              for now — it's a different card shape. */}
          {tab === "applied"
            ? [1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)
            : [1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
        </div>
      </PageScaffold>
    );
  }

  const activeStatusFilters = tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS;
  const activeCounts = tab === "posted" ? postedCounts : appliedCounts;

  // "Truly empty" — the underlying list has zero items (not merely
  // filtered down to none). When there's nothing at all, the secondary
  // "Posted tasks / Open" header with its search + status-filter has
  // nothing to act on, and the "0 tasks" count chip is pure noise. Both
  // are hidden so the empty state reads as a single, clean panel. When
  // items exist but the active filter hides them all, we keep the header
  // so the user can clear/change the filter that's hiding their tasks.
  const sourceCount = tab === "posted" ? postedJobs.length : appliedApps.length;
  const isTrulyEmpty = sourceCount === 0;

  // Per-tab "updated Xm ago" indicator — only shown after the first
  // user-triggered pull-to-refresh on this tab so it doesn't feel
  // noisy on a fresh load. The relative-time string is intentionally
  // coarse (no live ticker) since the value is only useful as a
  // glance-confidence signal.
  const refreshIndicator = (() => {
    if (!lastRefreshedAt) return null;
    const seconds = Math.max(0, Math.round((Date.now() - lastRefreshedAt) / 1000));
    if (seconds < 10) return "Just refreshed";
    if (seconds < 60) return `Updated ${seconds}s ago`;
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `Updated ${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return `Updated ${hrs}h ago`;
  })();

  return (
    <>
      <PageScaffold
        animate
        header={<DashboardHeader titleAs="h1" title={tab === "posted" ? "My Posts" : "My Jobs"} />}
        titleCard={
          /* The "N jobs" count chip was removed (2026-07-25 decision) — the
             section name already lives in the top bar and the count read as
             redundant noise. The title card now carries ONLY the transient
             post-refresh freshness cue (absent on a fresh load), and drops
             out entirely when there's nothing to show so no empty frosted
             card floats above the panel. */
          isTrulyEmpty || !refreshIndicator ? undefined : (
            <p
              className="truncate font-sans font-semibold uppercase leading-none"
              style={{
                fontSize: "0.62rem",
                letterSpacing: "0.16em",
                color: "hsl(var(--olivewood) / 0.8)",
              }}
            >
              <span aria-hidden="true">{refreshIndicator}</span>
            </p>
          )
        }
      >
          {/* Secondary header (status title + search/filter) is hidden
              when there's nothing to act on — see `isTrulyEmpty`. */}
          {!isTrulyEmpty && (
            <ActivityHeader
              tab={tab}
              activeStatusFilters={activeStatusFilters}
              activeCounts={activeCounts}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              filterOpen={filterOpen}
              setFilterOpen={setFilterOpen}
              searchOpen={searchOpen}
              setSearchOpen={setSearchOpen}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
          )}

          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-4 pt-3 pb-0"
          >
          {(tab === "posted" && filteredPostedJobs.length === 0) || (tab === "applied" && filteredAppliedApps.length === 0) ? (
            // Empty state — a liquid-glass card that fills the panel and
            // bleeds beneath the dock (flat bottom, no hard edge), matching
            // the Dashboard / Messages empty-state pattern.
            <ActivityEmptyState
              tab={tab}
              loadError={!!loadError}
              postedJobsCount={postedJobs.length}
              appliedAppsCount={appliedApps.length}
              statusFilter={statusFilter}
              hasSearch={!!searchQuery.trim()}
              onRetry={refresh}
              onNavigate={navigate}
            />
          ) : (
            <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}>
          {tab === "posted" && (
            <Suspense fallback={
              <div className="px-0 space-y-2.5">
                {[1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
              </div>
            }>
            <SectionBoundary label="your posts">
            <PostedJobsTab
              groupByStatus={statusFilter === "all"}
              jobs={filteredPostedJobs}
              applicantCounts={applicantCounts}
              expandedJobId={actions.expandedJobId}
              setExpandedJobId={actions.setExpandedJobId}
              helperNames={helperNames}
              completedJobMeta={completedJobMeta}
              startRequestedJobIds={startRequestedJobIds}
              latestTracking={latestTracking}
              groupHelpersByJob={groupHelpersByJob}
              userId={user!.id}
              onBoost={actions.setBoostJobId}
              onEdit={actions.setEditJob}
              onCancel={actions.tryCancelJob}
              onComplete={actions.completeJob}
              completingJobId={actions.completingJobId}
              onRevision={actions.setRevisionJobId}
              onNoShow={actions.setNoShowJobId}
              onTip={(jobId, name) => { actions.setEnhancedTipJobId(jobId); actions.setEnhancedTipHelperName(name); }}
              onReview={actions.openReviewForPosted}
              onDispute={actions.setDisputeJob}
              onViewDispute={actions.setViewDisputeJob}
              onConfirmStart={actions.confirmStartJob}
              confirmingStartJobId={actions.confirmingStartJobId}
              onConfirmArrival={actions.confirmArrival}
              confirmingArrivalJobId={actions.confirmingArrivalJobId}
              onConfirmWorking={actions.confirmWorking}
              confirmingWorkingJobId={actions.confirmingWorkingJobId}
              onLoadApplications={actions.loadApplications}
              selectedJob={actions.selectedJob}
              setSelectedJob={actions.setSelectedJob}
              applications={actions.applications}
              applicationsLoading={actions.applicationsLoading}
              applicationsError={actions.applicationsError}
              onAcceptApplication={actions.acceptApplication}
              onDeclineApplication={actions.declineApplication}
              onLoadInlineApplicants={actions.loadInlineApplicants}
              inlineApplicants={actions.inlineApplicants}
              loadingApplicants={actions.loadingApplicants}
              applicantErrors={actions.applicantErrors}
              onActionComplete={refresh}
            />
            </SectionBoundary>
            </Suspense>
          )}

          {tab === "applied" && (
            <Suspense fallback={
              <div className="px-0 space-y-2.5">
                {[1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)}
              </div>
            }>
            <SectionBoundary label="your jobs">
            <AppliedJobsTab
              groupByStatus={statusFilter === "all"}
              apps={filteredAppliedApps}
              highlightAppId={highlightAppId}
              expandedJobId={actions.expandedJobId}
              setExpandedJobId={actions.setExpandedJobId}
              helperReviewedJobIds={helperReviewedJobIds}
              latestTracking={latestTracking}
              userId={user!.id}
              onHelperResponse={actions.handleHelperResponse}
              respondingHelperAppId={actions.respondingHelperAppId}
              onComplete={actions.completeJob}
              completingJobId={actions.completingJobId}
              onResolveRevision={actions.resolveRevision}
              onHelperReview={(jobId, posterId, posterName) => actions.setHelperReviewJob({ jobId, posterId, posterName })}
              onDispute={actions.setDisputeJob}
              onViewDispute={actions.setViewDisputeJob}
              onRefresh={refresh}
            />
            </SectionBoundary>
            </Suspense>
          )}
            </div>
          )}
          </PullToRefreshWrapper>
      </PageScaffold>

      <ActivityDialogs
        user={user ? { id: user.id } : null}
        revisionJobId={actions.revisionJobId}
        setRevisionJobId={actions.setRevisionJobId}
        onRevisionRequested={refresh}
        editJob={actions.editJob}
        setEditJob={actions.setEditJob}
        boostJobId={actions.boostJobId}
        setBoostJobId={actions.setBoostJobId}
        enhancedTipJobId={actions.enhancedTipJobId}
        enhancedTipHelperName={actions.enhancedTipHelperName}
        setEnhancedTipJobId={actions.setEnhancedTipJobId}
        setEnhancedTipHelperName={actions.setEnhancedTipHelperName}
        noShowJobId={actions.noShowJobId}
        setNoShowJobId={actions.setNoShowJobId}
        onNoShow={actions.handleNoShow}
        reportingNoShow={actions.reportingNoShow}
        cancelDialogJob={actions.cancelDialogJob}
        setCancelDialogJob={actions.setCancelDialogJob}
        completionPromptJob={actions.completionPromptJob}
        setCompletionPromptJob={actions.setCompletionPromptJob}
        deadlineDialogApp={actions.deadlineDialogApp}
        setDeadlineDialogApp={actions.setDeadlineDialogApp}
        onDeadlineConfirm={actions.confirmAcceptWithDeadline}
        disputeJob={actions.disputeJob}
        setDisputeJob={actions.setDisputeJob}
        viewDisputeJob={actions.viewDisputeJob}
        setViewDisputeJob={actions.setViewDisputeJob}
        reviewJob={actions.reviewJob}
        reviewTarget={actions.reviewTarget}
        setReviewJob={actions.setReviewJob}
        setReviewTarget={actions.setReviewTarget}
        helperReviewJob={actions.helperReviewJob}
        setHelperReviewJob={actions.setHelperReviewJob}
        helperNames={helperNames}
        onRefresh={refresh}
      />
      {actions.idvDialogOpen && (
        <Suspense fallback={null}>
          <IDVPromptDialog
            open={actions.idvDialogOpen}
            onOpenChange={(o) => { actions.setIdvDialogOpen(o); if (!o) actions.setPendingAcceptApp(null); }}
            reason={actions.pendingAcceptApp ? "Helpr requires a one-time ID + selfie check before you accept your first job. Posters won't see their full address until you're verified." : undefined}
            status={actions.idvStatus as never}
            failureReason={actions.idvFailureReason}
          />
        </Suspense>
      )}
      {actions.w9Context && user && (
        <Suspense fallback={null}>
          <W9CollectionDialog
            open={actions.w9DialogOpen}
            onOpenChange={actions.setW9DialogOpen}
            jobId={actions.w9Context.jobId}
            helperId={user.id}
            businessId={actions.w9Context.businessId}
          />
        </Suspense>
      )}
    </>
  );
};

export default Activity;
