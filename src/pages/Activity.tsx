import { useEffect, useState } from "react";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useActivityData } from "@/hooks/useActivityData";
import { ActivityDialogs } from "@/components/activity/ActivityDialogs";
import { PostedJobsTab } from "@/components/activity/PostedJobsTab";
import { AppliedJobsTab } from "@/components/activity/AppliedJobsTab";
import { type Tab } from "@/components/activity/activityConstants";
import { IDVPromptDialog } from "@/components/IDVPromptDialog";
import { useActivityActions } from "@/pages/activity/useActivityActions";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  useActivityFilters,
} from "@/pages/activity/activityFilters";
import { ActivityHeader } from "@/pages/activity/ActivityHeader";
import { ActivityEmptyState } from "@/pages/activity/ActivityEmptyState";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";

const Activity = ({ defaultTab = "posted" }: { defaultTab?: "posted" | "applied" }) => {
  usePageTitle(defaultTab === "posted" ? "My Posts — Helpr" : "My Jobs — Helpr");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useCurrentUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const tab = defaultTab as Tab;
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const paramFilter = searchParams.get("filter");
    if (paramFilter) return paramFilter;
    return defaultTab === "applied" ? "pending" : "open";
  });

  // Sync filter when URL search params change (e.g. navigating from a notification)
  useEffect(() => {
    const paramFilter = searchParams.get("filter");
    if (paramFilter && paramFilter !== statusFilter) {
      setStatusFilter(paramFilter);
    }
  }, [searchParams]);

  const {
    loading, loadError, postedJobs, appliedApps, applicantCounts,
    startRequestedJobIds, helperNames, completedJobMeta,
    helperReviewedJobIds, refresh,
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

  // Pull-to-refresh — must run unconditionally (hook order). Same
  // gesture pattern as Dashboard.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { await refresh(); },
  });

  if (loading) {
    // Loading state mirrors the loaded layout: two-box stack on a
    // bg-premium-page shell with skeleton cards inside the bottom box.
    return (
      <PageScaffold
        header={<DashboardHeader />}
        titleCard={
          <>
            <Skeleton className="h-7 w-32 rounded" />
            <Skeleton className="h-3 w-44 mt-2 rounded" />
          </>
        }
      >
        <div className="px-4 pt-3 space-y-2.5">
          {[1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
        </div>
      </PageScaffold>
    );
  }

  const activeStatusFilters = tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS;
  const activeCounts = tab === "posted" ? postedCounts : appliedCounts;

  return (
    <>
      <PageScaffold
        header={<DashboardHeader />}
        titleCard={
            <div className="flex flex-col leading-none">
              <h1 className="text-page-title leading-tight">
                {tab === "posted" ? "My Posts" : "My Jobs"}
              </h1>
              <p
                className="mt-1 truncate font-sans font-semibold uppercase"
                style={{
                  fontSize: "0.62rem",
                  letterSpacing: "0.16em",
                  color: "hsl(var(--olivewood) / 0.55)",
                }}
              >
                {(tab === "posted" ? filteredPostedJobs.length : filteredAppliedApps.length)}{" "}
                {(tab === "posted" ? filteredPostedJobs.length : filteredAppliedApps.length) === 1 ? "task" : "tasks"}
              </p>
            </div>
        }
      >
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
              onRetry={refresh}
              onNavigate={navigate}
            />
          ) : (
            <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}>
          {tab === "posted" && (
            <PostedJobsTab
              jobs={filteredPostedJobs}
              applicantCounts={applicantCounts}
              expandedJobId={actions.expandedJobId}
              setExpandedJobId={actions.setExpandedJobId}
              helperNames={helperNames}
              completedJobMeta={completedJobMeta}
              startRequestedJobIds={startRequestedJobIds}
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
              onConfirmStart={actions.confirmStartJob}
              onConfirmArrival={actions.confirmArrival}
              onConfirmWorking={actions.confirmWorking}
              onLoadApplications={actions.loadApplications}
              selectedJob={actions.selectedJob}
              setSelectedJob={actions.setSelectedJob}
              applications={actions.applications}
              onAcceptApplication={actions.acceptApplication}
              onLoadInlineApplicants={actions.loadInlineApplicants}
              inlineApplicants={actions.inlineApplicants}
              loadingApplicants={actions.loadingApplicants}
              applicantErrors={actions.applicantErrors}
            />
          )}

          {tab === "applied" && (
            <AppliedJobsTab
              apps={filteredAppliedApps}
              expandedJobId={actions.expandedJobId}
              setExpandedJobId={actions.setExpandedJobId}
              helperReviewedJobIds={helperReviewedJobIds}
              userId={user!.id}
              onHelperResponse={actions.handleHelperResponse}
              onComplete={actions.completeJob}
              completingJobId={actions.completingJobId}
              onResolveRevision={actions.resolveRevision}
              onHelperReview={(jobId, posterId, posterName) => actions.setHelperReviewJob({ jobId, posterId, posterName })}
              onRefresh={refresh}
            />
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
        reviewJob={actions.reviewJob}
        reviewTarget={actions.reviewTarget}
        setReviewJob={actions.setReviewJob}
        setReviewTarget={actions.setReviewTarget}
        helperReviewJob={actions.helperReviewJob}
        setHelperReviewJob={actions.setHelperReviewJob}
        helperNames={helperNames}
        onRefresh={refresh}
      />
      <IDVPromptDialog
        open={actions.idvDialogOpen}
        onOpenChange={(o) => { actions.setIdvDialogOpen(o); if (!o) actions.setPendingAcceptApp(null); }}
        reason={actions.pendingAcceptApp ? "Helpr requires a one-time ID + selfie check before you accept your first job. Posters won't see their full address until you're verified." : undefined}
        status={actions.idvStatus as never}
        failureReason={actions.idvFailureReason}
      />
    </>
  );
};

export default Activity;
