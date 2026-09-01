import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingHeading } from "@/components/ui/LoadingHeading";
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
const AwardGateDialog = lazy(() =>
  import("@/components/AwardGateDialog").then((m) => ({ default: m.AwardGateDialog })),
);
const W9CollectionDialog = lazy(() => import("@/components/W9CollectionDialog"));
// Same "Report" surface Browse uses (Dashboard.tsx) — a Done-tab job on
// My Posts gets the identical dialog, reportedType="job".
const ReportDialog = lazy(() => import("@/components/ReportDialog"));
import { useActivityActions } from "@/pages/activity/useActivityActions";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  useActivityFilters,
  postedActivityBucket,
  appliedActivityBucket,
} from "@/pages/activity/activityFilters";
import { ActivityHeader, ACTIVITY_HEADER_PADDING } from "@/pages/activity/ActivityHeader";
import { ActivityEmptyState } from "@/pages/activity/ActivityEmptyState";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import { useSearchParamMirror } from "@/hooks/useSearchParamMirror";
import SectionBoundary from "@/components/SectionBoundary";
import { defaultStatusFilterFor } from "@/components/activity/activityConstants";

const Activity = ({ defaultTab = "posted" }: { defaultTab?: "posted" | "applied" }) => {
  usePageTitle(defaultTab === "posted" ? "My Posts — Helpr" : "My Jobs — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCurrentUser();
  // Full-bleed app bar — web-desktop ONLY. My Posts / My Jobs carry no app
  // bar on phone/native (ActivityHeader's own title is the page name there),
  // matching every other Activity/Messages screen; on web-desktop the new
  // full-bleed DashboardHeader spans above the sidebar rail the same way it
  // now does on Dashboard.
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
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    return searchParams.get("filter") ?? defaultFilter;
  });

  // Deep-link highlight — the notification for "poster viewed your
  // application" links to /my-jobs?highlight=<applicationId>. We read
  // it once on mount, hand it to AppliedJobsTab so the matching card
  // can scroll into view + pulse, then strip it from the URL (replace,
  // not push) so Back doesn't re-trigger the animation.
  const [highlightAppId, setHighlightAppId] = useState<string | null>(() =>
    defaultTab === "applied" ? (searchParams.get("highlight") ?? null) : null,
  );

  // Deep-link to ONE JOB — `?job=<jobId>`.
  //
  // This is the param nearly every notification wants to send, and until now
  // nothing on this screen read it. `notify_on_payment_escrowed` has linked
  // "Payment secured in escrow" / "Job funded" to `/my-posts?job=<id>` and
  // `/my-jobs?job=<id>` since 20260824070000 — the route resolved, the param
  // was dropped on the floor, and the reader landed on the default "Needs you"
  // bucket, which for a freshly-funded booking is the one bucket the job is
  // NOT in. 79 rows in prod `notifications` carry that shape.
  //
  // A STATIC filter cannot fix that from the producer side: which bucket a job
  // is in depends on the job's live state (whose move is it?), not on which
  // event fired the notification. So resolve it HERE, where the job is already
  // loaded: find the job, ask activityFilters which bucket it lands in right
  // now, and select that bucket. A deep link is then always right, and stays
  // right as the job moves between buckets.
  //
  // Same treatment for `?highlight=<applicationId>`: a "poster viewed your
  // application" notification highlighted a card that the default filter was
  // hiding, because a pending application buckets to `waiting`, not
  // `needs_you`.
  //
  // Deliberately NOT applied when the link carries its own `?filter=` — an
  // explicit bucket in the URL is the caller being specific, and it wins.
  const [deepLinkJobId] = useState<string | null>(() => searchParams.get("job"));
  const [deepLinkHadFilter] = useState<boolean>(() => searchParams.get("filter") !== null);
  const deepLinkResolved = useRef(false);

  // "Report" on a Done-tab My Posts card — same dialog Browse uses.
  const [reportJobId, setReportJobId] = useState<string | null>(null);

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

  // Mirror filter + search into the URL through the SHARED hook.
  //
  // This screen used to hand-roll the same job in three interacting effects,
  // and it is the reason /my-jobs and /my-posts kept crashing into the route
  // error boundary. The failure mode is not obvious: `setSearchParams`
  // navigates unconditionally AND its identity churns on every location
  // change, so an effect that both writes it and depends on it re-arms itself.
  // WebKit throws at ~100 replaceState calls in 10s, which unmounts the route.
  // error_logs shows 19 of the last 20 RouteErrorBoundary entries are exactly
  // that message, across /browse, /my-jobs and /my-posts.
  //
  // /browse had the identical bug and was cured by moving onto
  // useSearchParamMirror, which decides OUTSIDE the updater (so the navigator
  // is never called on a no-op) and reaches setSearchParams through a ref (so
  // its identity cannot feed back into the deps). /browse has been clean since.
  // Activity was the last screen still hand-rolling it; this converges it.
  //
  // Empty string means "default" to the hook, so the param is DROPPED rather
  // than written when the filter is at its default and the search is blank —
  // preserving the previous behaviour of keeping a pristine view's URL clean.
  // `highlight` is not listed here and is therefore left untouched by the
  // hook; the one-shot effect above still strips it on mount.
  useSearchParamMirror(
    {
      filter: statusFilter === defaultFilter ? "" : statusFilter,
      q: searchQuery.trim(),
    },
    (read) => {
      const nextFilter = read("filter") || defaultFilter;
      if (nextFilter !== statusFilter) setStatusFilter(nextFilter);
      const nextQuery = read("q");
      if (nextQuery !== searchQuery.trim()) {
        setSearchQuery(nextQuery);
        if (nextQuery) setSearchOpen(true);
      }
    },
    "activity",
  );

  const {
    loading, loadError, postedJobs, appliedApps, applicantCounts, pendingApplicantCounts,
    helperNames, completedJobMeta,
    helperReviewedJobIds, latestTracking, groupHelpersByJob, refresh,
    // Only THIS tab's data blocks the first card. The other tab's core query
    // is warmed on idle inside the hook, so switching still comes out of cache.
  } = useActivityData(user, tab);

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

  // Resolve `?job=` / `?highlight=` to the bucket the target is ACTUALLY in.
  //
  // Runs once, after this tab's data has landed (the job has to exist before
  // its bucket can be asked for). If the target isn't in the list at all — a
  // job from the other side of the app, a stale link — we still drop the param
  // and leave the view on its default rather than pinning a bucket that would
  // be empty for a different reason.
  //
  // The `job` param is stripped in the SAME write that sets `filter`, so the
  // mirror's adopt() pass sees the new bucket already in the URL and can't
  // reset it back to the default in between.
  //
  // (Observed: when a `filter` IS written, useSearchParamMirror's own write
  // effect can re-run off the pre-navigation `search` and put `job` back. That
  // is harmless and deliberately not fought — a second writer racing that hook
  // is what caused the replaceState floods it was built to stop. A lingering
  // `?job=` just means a refresh re-lands on the same bucket, which is what
  // the link asked for.)
  useEffect(() => {
    if (deepLinkResolved.current) return;
    if (!deepLinkJobId && !highlightAppId) return;
    if (loading) return;
    deepLinkResolved.current = true;

    let bucket: string | null = null;
    if (tab === "posted") {
      const job = deepLinkJobId ? postedJobs.find((j) => j.id === deepLinkJobId) : undefined;
      if (job) bucket = postedActivityBucket(job, pendingApplicantCounts?.[job.id] ?? 0);
    } else {
      // `?job=` names the JOB; `?highlight=` names the APPLICATION. Either one
      // identifies the same card on this tab.
      const app =
        (deepLinkJobId ? appliedApps.find((a) => a.job_id === deepLinkJobId) : undefined) ??
        (highlightAppId ? appliedApps.find((a) => a.id === highlightAppId) : undefined);
      if (app) {
        bucket = appliedActivityBucket(app);
        // Pulse the card we just navigated to, even when the link only knew
        // the job id.
        if (!highlightAppId) setHighlightAppId(app.id);
      }
    }

    // An explicit `?filter=` in the link wins — see the note on
    // `deepLinkHadFilter`.
    if (deepLinkHadFilter) bucket = null;

    const next = new URLSearchParams(searchParams);
    const hadJobParam = next.has("job");
    if (hadJobParam) next.delete("job");
    if (bucket) {
      setStatusFilter(bucket);
      // Mirror it into the URL only when it differs from the default, matching
      // useSearchParamMirror's "empty means default, so drop the param" rule.
      if (bucket === defaultFilter) next.delete("filter");
      else next.set("filter", bucket);
    }
    if (hadJobParam || bucket) setSearchParams(next, { replace: true });
    // One-shot: guarded by deepLinkResolved, so the churn of `searchParams`
    // and the two lists can't re-run it. Deps are only what has to LAND before
    // the bucket can be computed; everything else is read through the closure.
  }, [loading, postedJobs, appliedApps, pendingApplicantCounts]);

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
      pendingApplicantCounts,
    });

  // Pull-to-refresh — refetches this tab's core + detail queries only (the
  // other tab has its own keys and its own idle warm), and each Activity
  // instance ("/my-posts" vs "/my-jobs") tracks its own pull-state so one
  // tab's refresh never leaks into the other.
  const tabRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);
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

  const activeStatusFilters = tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS;
  const activeCounts = tab === "posted" ? postedCounts : appliedCounts;

  /* NO AUTO-TAB-SWITCH. The tab you are on is the tab you chose.

     There used to be an effect here that, on the first load of a tab whose
     default bucket came up empty, silently moved the selection to the first
     bucket that had items. It contradicted this app's stated rule outright:
     `defaultStatusFilterFor` in activityConstants.ts says there is
     "deliberately NO automatic fallback to another tab (owner decision) — a
     default that silently moves is harder to reason about than one that holds
     still", and names ActivityEmptyState's pointer as the intended answer.
     Two comments, one codebase, opposite instructions.

     The rule wins, because the reason the effect existed is now handled
     properly. That pointer had always NAMED where the items were ("Nothing
     under needs you — but you have 3 in Scheduled") while the only button on
     the panel pointed at Post a Job — so the fallback was papering over an
     empty state that told you where to go and then wouldn't take you. It
     offers the jump as a button now (see ActivityEmptyState), so landing on an
     empty "Needs you" costs one deliberate tap instead of a silent move.

     "Nothing needs you" is also good news, and worth seeing. */

  // "Truly empty" — the underlying list has zero items (not merely
  // filtered down to none). When there's nothing at all, the secondary
  // "Posted tasks / Open" header with its search + status-filter has
  // nothing to act on, and the "0 tasks" count chip is pure noise. Both
  // are hidden so the empty state reads as a single, clean panel. When
  // items exist but the active filter hides them all, we keep the header
  // so the user can clear/change the filter that's hiding their tasks.
  const sourceCount = tab === "posted" ? postedJobs.length : appliedApps.length;
  const isTrulyEmpty = sourceCount === 0;

  const isWebDesktop = useIsWebDesktop();


  if (loading) {
    // Loading state mirrors the loaded layout: two-box stack on a
    // bg-premium-page shell with skeleton cards inside the bottom box.
    return (
      <PageScaffold
        // Same title-card padding + row height as the loaded header, so the
        // skeleton→loaded swap doesn't thump the card taller or shorter.
        titleCard={
          <div className="flex items-center" style={{ minHeight: "44px" }}>
            <Skeleton className="h-4 w-32 rounded" />
          </div>
        }
        titleCardClassName={ACTIVITY_HEADER_PADDING}
      >
        <div className="px-4 pt-3 space-y-2.5">
          {/* The shimmer carries no words, so without this the pending screen
              had zero headings and zero copy — the page was unnameable to a
              screen reader and the "exactly one h1" invariant only held once
              the data landed. Visually hidden: the skeleton stays the visible
              design. */}
          <LoadingHeading
            title={tab === "posted" ? "My Posts" : "My Jobs"}
            message={tab === "posted" ? "Loading your posts…" : "Loading your jobs…"}
          />
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




  // The header renders ALWAYS — including on an empty list. It used to be
  // replaced by null, which took the page title down with the filter tabs and
  // left the empty view headless: the panel appeared to lose its identity the
  // moment data resolved to zero, and Activity/Messages both "changed the
  // view of the screen" after load. Owner: the title should still be there.
  //
  // What is genuinely dead on an empty list is the CONTROLS — status tabs and
  // a "0 tasks" count have nothing to act on — so those are what drop out, by
  // passing an empty filter list. Title stays, controls go, layout is stable
  // from first paint whether the list has items or not.
  // One source of truth for "this tab has nothing to list" — the scroll
  // wrapper's padding and the empty-state branch must agree, or the empty
  // card gets inset inside the panel card and doubles the frame.
  const showEmptyState =
    (tab === "posted" && filteredPostedJobs.length === 0) ||
    (tab === "applied" && filteredAppliedApps.length === 0);

  const headerEl = (
    <ActivityHeader
      title={tab === "posted" ? "My Posts" : "My Jobs"}
      // Desktop: the app bar already identifies the app, so the page name is
      // sr-only here and the row is just its count + controls. Phone and
      // native keep the visible title; they have no bar.
      titleSrOnly={isWebDesktop}
      // Desktop has room for the tabs beside the screen name; phone puts them
      // on their own line under it. Same tabs either way.
      inlineFilters={isWebDesktop}
      // Empty list => no tabs and no count; see the note above headerEl.
      activeStatusFilters={isTrulyEmpty ? [] : activeStatusFilters}
      activeCounts={activeCounts}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
    />
  );

  return (
    <>
      {/* ONE BOX on the desktop website (owner: "merge into 1"). The header
          used to be the scaffold's own floating title card, so the screen was
          two stacked liquid-glass boxes with a gap between them saying one
          thing between them. On desktop it is now the panel's first child,
          under a hairline, so the count + controls sit directly on top of the
          cards they describe.

          Phone and native keep the two-card stack: there the header carries
          the VISIBLE page name (no app bar exists to carry it), and that name
          reads as chrome rather than as a row of the list. */}
      <PageScaffold
        animate
        titleCard={isWebDesktop ? undefined : headerEl}
        titleCardClassName={ACTIVITY_HEADER_PADDING}
      >
          {isWebDesktop && headerEl && (
            <div
              className="shrink-0 px-5 py-1"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
            >
              {headerEl}
            </div>
          )}
          {/* The sr-only <h1> that used to stand in here is gone: the real
              ActivityHeader h1 now renders on the empty list too, so adding
              this one would give the document TWO h1s. */}

          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            // The list needs side padding so cards clear the panel edge. The
            // EMPTY state must not have it: EmptyState renders its own
            // `dock` card, so 16px of inset put that card inside the
            // PageScaffold panel card and you saw TWO nested rounded frames
            // a few px apart (visible on device, My Jobs / My Posts). The
            // comment below already said this card "fills the panel" — the
            // padding was what stopped it.
            className={showEmptyState ? "flex-1 min-h-0 pb-0" : "flex-1 min-h-0 px-4 pt-3 pb-0"}
          >
          {showEmptyState ? (
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
              statusCounts={activeCounts}
              statusLabels={activeStatusFilters}
              onRetry={refresh}
              onNavigate={navigate}
              onSelectStatusFilter={setStatusFilter}
            />
          ) : (
            /* `min-h-full flex flex-col` so a SHORT list can fill the panel.
               PageScaffold's panel is a fixed-height liquid-glass card, so a
               one-card view left ~426px of blank card stock above the nav at
               375 — measured, and the owner's "roughly half the screen empty".
               Giving this wrapper the panel's full height lets the tab's
               end-of-list block take the slack with `mt-auto`/`flex-1` instead
               of the void taking it. Nothing moves on a full list: `min-h-`,
               not `h-`, so the wrapper still grows past the fold as before. */
            <div
              className="min-h-full flex flex-col"
              style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + 96px)" }}
            >
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
              expandedJobIds={actions.expandedJobIds}
              toggleExpandedJobId={actions.toggleExpandedJobId}
              helperNames={helperNames}
              completedJobMeta={completedJobMeta}
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
              onReport={(job) => setReportJobId(job.id)}
              onViewDispute={actions.setViewDisputeJob}
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
              // Context for the END-OF-LIST block, which fills the panel's
              // leftover height on a short list (owner: three cards and then
              // "roughly half the screen empty"). Same four values
              // ActivityEmptyState already takes, so the two surfaces say the
              // same sentence about where the rest of your posts are.
              statusFilter={statusFilter}
              statusCounts={activeCounts}
              statusLabels={activeStatusFilters}
              onSelectStatusFilter={setStatusFilter}
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
              expandedJobIds={actions.expandedJobIds}
              toggleExpandedJobId={actions.toggleExpandedJobId}
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
      {actions.awardBlockReason && (
        <Suspense fallback={null}>
          <AwardGateDialog
            open={!!actions.awardBlockReason}
            onOpenChange={(o) => {
              if (!o) {
                actions.setAwardBlockReason(null);
                actions.setPendingAcceptApp(null);
              }
            }}
            reason={actions.awardBlockReason}
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
      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog
            open={!!reportJobId}
            onClose={() => setReportJobId(null)}
            reportedType="job"
            reportedId={reportJobId}
          />
        </Suspense>
      )}
    </>
  );
};

export default Activity;
