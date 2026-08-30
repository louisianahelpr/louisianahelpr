import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SearchX, Wrench } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { type Job, type EnrichedApplication } from "./activityConstants";
import { PostedJobCard } from "./PostedJobCard";
import { ActivitySectionedView } from "@/pages/activity/ActivitySectionedView";
import { bucketPostedJob } from "@/pages/activity/activityFilters";
import { useBulkDismiss } from "@/pages/activity/useBulkDismiss";
import { BulkDismissBar } from "@/pages/activity/BulkDismissBar";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { BulkDismissibleWrapper } from "./postedJobs/BulkDismissibleWrapper";
import { useApplicantSignals } from "./postedJobs/useApplicantSignals";
import { useJobAnalytics } from "./postedJobs/useJobAnalytics";
import { ApplicantsPanel } from "./postedJobs/ApplicantsPanel";

interface PostedJobsTabProps {
  jobs: Job[];
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  /** Batched per-card tracking + group-helper data, pre-fetched by
      useActivityData. Hoisted here so each <JobTracking>/<GroupJobHelpers>
      doesn't re-fetch on mount (N+1 across active cards). */
  latestTracking: Record<string, TrackingData | null>;
  groupHelpersByJob: Record<string, GroupHelperLite[]>;
  userId: string;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  confirmingArrivalJobId: string | null;
  onConfirmWorking: (jobId: string) => void;
  confirmingWorkingJobId: string | null;
  onLoadApplications: (job: Job) => void;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  /** True while the full-screen applicants fetch is in-flight. */
  applicationsLoading?: boolean;
  /** True when the full-screen applicants fetch failed. */
  applicationsError?: boolean;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onDeclineApplication: (app: EnrichedApplication, note: string, jobTitle: string) => void;
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  applicantErrors: Record<string, boolean>;
  /** Refetch the feed after an inline card mutation (e.g. dispute action). */
  onActionComplete: () => void;
  /** When true, render items grouped into collapsible Active /
   *  Completed / Cancelled sections instead of a flat list.
   *  Driven by the page-level "All" status filter. The page's
   *  outer header (ActivityHeader) is the sole source of truth for
   *  filter + search in both modes. */
  groupByStatus?: boolean;
}

export const PostedJobsTab = ({
  jobs, applicantCounts, expandedJobId, setExpandedJobId,
  helperNames, completedJobMeta,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onViewDispute, onConfirmArrival, confirmingArrivalJobId, onConfirmWorking, confirmingWorkingJobId,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onDeclineApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete, groupByStatus = false,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();

  // Bulk-dismiss for cancelled posts — long-press a Cancelled card to
  // enter selection mode, then bulk-hide them from view. The hide is
  // local (sessionStorage) so the audit record on the server stays
  // intact.
  const bulkDismiss = useBulkDismiss("posted");

  // Trust-graph applicant signals (neighbor counts, completed counts,
  // repeat-hire %, on-time %, distances) batch-fetched for the selected
  // job's applicants — fed to the comparison panel's scoring.
  const {
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceMap,
  } = useApplicantSignals(applications, selectedJob);

  // Per-job analytics (view counts + conversion + bid range) for the
  // PostedJobCard mini-panel.
  // viewCounts is no longer read: the card stopped rendering reach, and the
  // Applicants panel takes the richer jobAnalyticsMap entry instead.
  const { jobAnalyticsMap } = useJobAnalytics(jobs, applicantCounts);

  // Filter the incoming jobs through the dismissed set so a previously
  // hidden cancelled job stays hidden across re-renders. Cancelled jobs
  // are the only ones that can be dismissed; a non-cancelled job in the
  // dismissed set is a stale entry and is rendered normally.
  const visibleJobs = useMemo(
    () => jobs.filter((j) => {
      if (j.status !== "cancelled" && j.status !== "disputed") return true;
      return !bulkDismiss.dismissed.has(j.id);
    }),
    [jobs, bulkDismiss.dismissed],
  );

  // One source of truth for the per-row render so both the flat
  // list view and the grouped Sectioned view paint identical
  // cards. Cancelled cards get a long-press / checkbox wrapper that
  // drives the bulk-dismiss flow.
  const renderJobCard = (job: Job) => {
    const card = (
      <PostedJobCard
        job={job}
        applicantCounts={applicantCounts}
        expandedJobId={expandedJobId}
        setExpandedJobId={setExpandedJobId}
        helperNames={helperNames}
        completedJobMeta={completedJobMeta}
        // `latestTracking[job.id]` may legitimately be `null` ("we
        // looked, no row exists") — the card forwards that down so
        // <JobTracking> skips its own initial fetch. If the key is
        // absent (e.g. a not-yet-active job), the card passes
        // `undefined` and JobTracking falls back to its own query.
        initialTracking={latestTracking[job.id]}
        initialGroupHelpers={groupHelpersByJob[job.id]}
        userId={userId}
        onBoost={onBoost}
        onEdit={onEdit}
        onCancel={onCancel}
        onComplete={onComplete}
        completingJobId={completingJobId}
        onRevision={onRevision}
        onNoShow={onNoShow}
        onTip={onTip}
        onReview={onReview}
        onDispute={onDispute}
        onViewDispute={onViewDispute}
        onConfirmArrival={onConfirmArrival}
        confirmingArrivalJobId={confirmingArrivalJobId}
        onConfirmWorking={onConfirmWorking}
        confirmingWorkingJobId={confirmingWorkingJobId}
        onLoadApplications={onLoadApplications}
        onLoadInlineApplicants={onLoadInlineApplicants}
        inlineApplicants={inlineApplicants}
        loadingApplicants={loadingApplicants}
        applicantErrors={applicantErrors}
        onActionComplete={onActionComplete}
      />
    );
    const isCancelled = job.status === "cancelled" || job.status === "disputed";
    if (!isCancelled) return card;
    return (
      <BulkDismissibleWrapper
        selectionMode={bulkDismiss.selectionMode}
        selected={bulkDismiss.selected.has(job.id)}
        onLongPress={() => bulkDismiss.enterSelectionMode(job.id)}
        onTapInSelection={() => bulkDismiss.toggleSelected(job.id)}
      >
        {card}
      </BulkDismissibleWrapper>
    );
  };

  if (jobs.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={Wrench}
        illustration={<EmptyStateIllustration variant="posts" />}
        title="No posts yet in this view"
        body="Post your first task and we'll match you with ID-verified Louisiana Helprs nearby."
        action={
          <Button onClick={() => navigate("/post-job")} className="rounded-ds-md btn-press">
            <Wrench className="w-4 h-4 mr-1.5" /> Post a Task
          </Button>
        }
      />
    );
  }

  // The page header (ActivityHeader) owns the only search + status
  // filter — both modes render the already-filtered list. "All" routes
  // through the collapsible 3-section grouped shell; a specific status
  // renders a flat list. The applicants full-screen modal renders below
  // as a sibling so it surfaces in either mode.
  const listView = groupByStatus ? (
    <ActivitySectionedView
      tab="posted"
      items={visibleJobs}
      getKey={(job) => job.id}
      bucketize={bucketPostedJob}
      renderItem={renderJobCard}
    />
  ) : visibleJobs.length === 0 ? (
    <EmptyState
      variant="inline"
      icon={SearchX}
      title="No matches in this view"
      body="Nothing here fits that filter yet — try a different status from the filter button to see more."
    />
  ) : (
    // Flat (single-status) list rendered in normal document flow — the
    // same layout primitive the grouped Sectioned view uses (space-y-3 +
    // ds-activity-grid, single column on phone / two columns on wide
    // browser desktop). It intentionally is NOT window-virtualized: the
    // Activity panel scrolls inside its own container (PullToRefreshWrapper),
    // not the window, so a window virtualizer both mismatched the scroll
    // source and forced an explicit absolute list height that re-measured
    // from a fixed estimate on every remount — which is what made switching
    // "All" ↔ a single status visibly jump. Normal flow keeps the two views
    // structurally identical, so toggling between them stays stable.
    <div className="space-y-3 ds-activity-grid">
      {visibleJobs.map((job) => (
        <div key={job.id}>{renderJobCard(job)}</div>
      ))}
      {/* The "That's everything here." trailing line (which used to fill the
          blank space a 1-2 card bucket leaves in the fixed-height AppShell
          panel) was removed (owner, 2026-08-30). */}
    </div>
  );

  return (
    <div className="space-y-4">
      {listView}

      {/* Sticky bottom bulk-dismiss bar — surfaces only in selection
          mode. Long-pressing a Cancelled card enters this mode. */}
      {bulkDismiss.selectionMode && (
        <BulkDismissBar
          selectedCount={bulkDismiss.stats.selectedCount}
          onDismiss={bulkDismiss.dismissSelected}
          onCancel={bulkDismiss.exitSelectionMode}
        />
      )}

      {/* Applicants full-screen comparison view */}
      {selectedJob && (
        <ApplicantsPanel
          expandedJobId={expandedJobId}
          selectedJob={selectedJob}
          setSelectedJob={setSelectedJob}
          applications={applications}
          applicationsLoading={applicationsLoading}
          applicationsError={applicationsError}
          onLoadApplications={onLoadApplications}
          onAcceptApplication={onAcceptApplication}
          onDeclineApplication={onDeclineApplication}
          neighborCountMap={neighborCountMap}
          completedCountsMap={completedCountsMap}
          repeatHireMap={repeatHireMap}
          onTimeMap={onTimeMap}
          distanceMap={distanceMap}
          jobAnalytics={jobAnalyticsMap[selectedJob.id]}
        />
      )}
    </div>
  );
};
