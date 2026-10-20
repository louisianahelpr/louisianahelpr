import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MapPin, SearchX, Wrench, X } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { hapticLight } from "@/lib/haptics";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { type Job, type EnrichedApplication } from "../../components/job-card/activityConstants";
import { PostedJobCard } from "./PostedJobCard";
import { ActivityBucketGroups, POSTED_GROUP_LABEL } from "@/components/job-card/ActivityBucketGroups";
import { PagedActivityList } from "@/components/job-card/PagedActivityList";
import { postedActivityBucket } from "@/components/job-card/activityFilters";
import { useBulkDismiss } from "@/pages/posts/useBulkDismiss";
import { BulkDismissBar } from "@/pages/posts/BulkDismissBar";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { BulkDismissibleWrapper } from "./postedJobs/BulkDismissibleWrapper";
import { useApplicantSignals } from "./postedJobs/useApplicantSignals";
import { useJobAnalytics } from "./postedJobs/useJobAnalytics";
import { ApplicantsPanel } from "./postedJobs/ApplicantsPanel";
import { RecurringVisitPayments } from "./postedJobs/RecurringVisitPayments";
import { useAgeGate } from "@/hooks/useAgeGate";

interface PostedJobsTabProps {
  jobs: Job[];
  /**
   * Job id a `?job=` deep link resolved to, or null. Mirrors
   * AppliedJobsTab's `highlightAppId` — the poster side had no equivalent, so
   * the notification that says "your job X" landed on an unmarked list.
   */
  highlightJobId?: string | null;
  applicantCounts: Record<string, number>;
  /** Applications still AWAITING a decision, per job id. Forwarded to the card
   *  for its collapsed status strip — see PostedJobCardProps. */
  pendingApplicantCounts?: Record<string, number>;
  /** Per job: what happened to closed applications (closedApplicantsSummary). */
  closedApplicantSummaries?: Record<string, string>;
  expandedJobIds: Set<string>;
  toggleExpandedJobId: (id: string) => void;
  helperNames: Record<string, string>;
  /** Helper avatar URLs for the expanded card's Helpr tile (VN-22). */
  helperAvatars?: Record<string, string | null>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean; crewToReview?: Array<{ id: string; name: string }> }>;
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
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string, helperId?: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onReport: (job: Job) => void;
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
  /** Jobs > Posted, "All" filter (owner, 2026-10-19): group by whose move it
   *  is (Needs you / Upcoming / ...) under headers instead of a flat list. */
  groupByStatus?: boolean;
}

/**
 * One-time coach line for the location press-gesture.
 *
 * `helpr_` prefix so safeStorage mirrors it into Capacitor Preferences and it
 * survives a WebView data clear — a hint the user has already dismissed coming
 * back on every cold start is worse than never showing it.
 */
const LOCATION_PRESS_HINT_KEY = "helpr_myposts_location_press_hint_seen";

/**
 * "Tap opens the job. Press and hold the location for directions."
 *
 * The gesture is the fix for the owner's complaint ("tapping the location here
 * shouldn't open the map… I keep tapping it on accident"), but a gesture that
 * nothing advertises is a gesture nobody finds. The chip carries a visible
 * pressable treatment and a `title`/`aria-label` that say both actions; this
 * says it once, in words, above the list, and then goes away for good.
 *
 * ABOVE the list rather than inside the meta row on purpose. The row is
 * `flex-nowrap` with the location as its only shrinking element, so an inline
 * caption there does not cost the row a line — it costs the CITY its letters
 * ("Broussard" → "B.."). Measured at 375 before it was moved out here.
 *
 * Only when there is a card to point at: a hint above an empty list explains a
 * gesture on a control that is not on screen.
 */
function LocationPressHint({ onDismiss }: { onDismiss: () => void }) {
  // `items-center` (owner, 2026-09-14, VN-26: "needs to be centered better"):
  // pin, sentence and X share ONE vertical centre. It was `items-start` with a
  // `mt-0.5` nudge on the pin and a symmetric `-m-2.5` on the X, so the three
  // sat on different lines of sight.
  return (
    <div
      className="flex items-center gap-2 rounded-ds-md px-3 py-2"
      style={{
        background: "hsl(var(--olivewood) / 0.07)",
        border: "0.5px solid hsl(var(--olivewood) / 0.20)",
      }}
    >
      <MapPin
        aria-hidden
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: "hsl(var(--olivewood))" }}
        strokeWidth={2.25}
      />
      <p
        className="flex-1 min-w-0 font-sans leading-snug text-ds-11"
        style={{ color: "hsl(var(--olivewood) / 0.9)" }}
      >
        <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
          Tap a card to open it.
        </span>{" "}
        Press and hold the location to get directions.
      </p>
      {/* 44px-class target on a small glyph. `-my-2.5` cancels the vertical
          padding exactly, so the strip keeps its own height and the glyph stays
          on the row's centre line; `-mr-2.5` puts the glyph the same 12px from
          the right edge as the pin is from the left. No left negative margin —
          that only pulled the hit area over the sentence. */}
      <button
        type="button"
        onClick={() => { hapticLight(); onDismiss(); }}
        aria-label="Dismiss tip about opening the map"
        className="shrink-0 -my-2.5 -mr-2.5 p-2.5 ctl-exit text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * The end of the Posted list: a spacer that lets a short list sit at the top of
 * the panel. It used to carry "That's everything under this view. You also have
 * 14 in Needs You, 2 in Waiting, 1 in Scheduled, 22 in Done and 136 in
 * Cancelled" and a "Show Cancelled" button (Cowork design audit 2026-10-20,
 * J6): every one of those counts is already a status box at the top of the
 * screen and the Done / Cancelled rows right above it, it named "Upcoming"
 * "Scheduled", and it called the current filter "this view". Guard:
 * src/test/postedListNoDuplicateTail.test.tsx.
 */
function ListTail() {
  return <div aria-hidden className="mt-auto" />;
}

export const PostedJobsTab = ({
  jobs, highlightJobId, applicantCounts, pendingApplicantCounts, closedApplicantSummaries, expandedJobIds, toggleExpandedJobId,
  helperNames, helperAvatars, completedJobMeta,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onNoShow, onTip, onReview, onDispute, onReport, onViewDispute, onConfirmArrival, confirmingArrivalJobId, onConfirmWorking, confirmingWorkingJobId,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onDeclineApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete, groupByStatus = false,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();
  // Q1586(c): a saved birthday under 18 greys this Post entry out; a tap says why.
  const { gate: ageGate, gatedProps: ageGatedProps } = useAgeGate();

  // Bulk-dismiss for cancelled posts — long-press a Cancelled card to
  // enter selection mode, then bulk-hide them from view. The hide is
  // local (sessionStorage) so the audit record on the server stays
  // intact.
  const bulkDismiss = useBulkDismiss("posted");

  // Read ONCE, on mount, from a lazy initializer — safeStorage is synchronous
  // and hydrated before React mounts, so the first paint already knows whether
  // the hint has been seen and it never flashes in and back out.
  const [locationHintSeen, setLocationHintSeen] = useState(
    () => safeStorage.getItem(LOCATION_PRESS_HINT_KEY) === "1",
  );
  const dismissLocationHint = useCallback(() => {
    safeStorage.setItem(LOCATION_PRESS_HINT_KEY, "1");
    setLocationHintSeen(true);
  }, []);

  // Trust-graph applicant signals (neighbor counts, completed counts,
  // repeat-hire %, on-time %, distances) batch-fetched for the selected
  // job's applicants — fed to the comparison panel's scoring.
  const {
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceBandMap,
    signalsPending,
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
        highlight={!!highlightJobId && highlightJobId === job.id}
        applicantCounts={applicantCounts}
        pendingApplicantCounts={pendingApplicantCounts}
        closedApplicantSummaries={closedApplicantSummaries}
        expandedJobIds={expandedJobIds}
        toggleExpandedJobId={toggleExpandedJobId}
        helperNames={helperNames}
        helperAvatars={helperAvatars}
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
        onNoShow={onNoShow}
        onTip={onTip}
        onReview={onReview}
        onDispute={onDispute}
        onReport={onReport}
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
    // A fragment, not a wrapper: with nothing waiting the DOM is unchanged.
    return (
      <>
      <RecurringVisitPayments userId={userId} />
      <EmptyState
        variant="inline"
        icon={Wrench}
        illustration={<EmptyStateIllustration variant="posts" />}
        title="No posts yet in this view"
        body="Post your first job and we'll match you with ID-verified Louisiana Helprs nearby."
        action={
          <Button onClick={ageGate("post", () => navigate("/post-job"))} {...ageGatedProps("post")} className="rounded-ds-md btn-press">
            <Wrench className="w-4 h-4 mr-1.5" /> Post a Job
          </Button>
        }
      />
      </>
    );
  }

  // The page header (PostsHeader) owns the only search + status
  // filter — both modes render the already-filtered list. "All" groups by
  // whose move it is under headers; a specific status renders a flat list. The applicants full-screen modal renders below
  // as a sibling so it surfaces in either mode.
  const listView = groupByStatus ? (
    <ActivityBucketGroups
      items={visibleJobs}
      getKey={(job) => job.id}
      bucketOf={(job) => postedActivityBucket(job, pendingApplicantCounts?.[job.id] ?? 0)}
      renderItem={renderJobCard}
      labels={POSTED_GROUP_LABEL}
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
    <>
      <PagedActivityList items={visibleJobs} getKey={(job) => job.id} renderItem={renderJobCard} />
      {/* The "That's everything here." trailing line (which used to fill the
          blank space a 1-2 card bucket leaves in the fixed-height AppShell
          panel) was removed (owner, 2026-08-30). */}
    </>
  );

  return (
    /* `flex-1`, NOT `min-h-full`, is what lets ListTail's `mt-auto` reach the
       bottom of the panel.

       `min-h-full` was measured and does not work here: a percentage min-height
       only resolves against a parent with a DEFINITE height, and this subtree's
       parent chain (AppShell panel → scroll container → Activity's wrapper) is
       a stack of `flex-1`/`min-h-full` boxes whose computed `height` is `auto`,
       so the percentage collapsed and this div sat at its content height —
       330px inside a 672px parent, leaving the tail stranded halfway up the
       panel with the void still under it.

       As a FLEX ITEM of Activity's `flex flex-col` wrapper, `flex-1` needs no
       percentage to resolve: it absorbs the parent's free space directly. No
       `min-h-0` beside it, deliberately — a flex item's default `min-height:
       auto` is what stops a LONG list being compressed to fit the panel instead
       of scrolling past it.

       `gap-section` (Q191, the shared --section-gap: 12px phone, 16px sm+;
       was `gap-4`) replaces the `space-y-4` this container used to carry, and that
       swap is load-bearing, not cosmetic: Tailwind compiles `space-y-4` to
       `.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem }`, whose
       specificity BEATS the `.mt-auto` utility — so with `space-y-4` on the
       parent, ListTail's `mt-auto` was silently overwritten by a 1rem margin
       and the tail stopped 245px short of the bottom (measured). A flex `gap`
       produces the identical rhythm without touching margins. */
    <div className="flex flex-col gap-section flex-1">
      {/* Q210(b): $300+ recurring visits the payer must confirm on-session. */}
      {/* "Post a job" is the Jobs & Posts top bar's "+" (owner, 2026-10-19); no second pill here. */}
      <RecurringVisitPayments userId={userId} />
      {/* Only with cards on screen to point at — see LocationPressHint. */}
      {!locationHintSeen && visibleJobs.length > 0 && (
        <LocationPressHint onDismiss={dismissLocationHint} />
      )}
      {listView}

      {/* Fills the panel's leftover height on a short list. */}
      <ListTail />

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
          selectedJob={selectedJob}
          setSelectedJob={setSelectedJob}
          applications={applications}
          // The skeleton stays up until the RANKING inputs are here too —
          // see `signalsPending` in useApplicantSignals for the swap it stops.
          applicationsLoading={applicationsLoading || (applications.length > 0 && signalsPending)}
          applicationsError={applicationsError}
          onLoadApplications={onLoadApplications}
          onAcceptApplication={onAcceptApplication}
          onDeclineApplication={onDeclineApplication}
          neighborCountMap={neighborCountMap}
          completedCountsMap={completedCountsMap}
          repeatHireMap={repeatHireMap}
          onTimeMap={onTimeMap}
          distanceBandMap={distanceBandMap}
          jobAnalytics={jobAnalyticsMap[selectedJob.id]}
          // The two levers the "nobody has applied yet" empty state offers.
          // Same handlers the card behind the overlay uses, so the dialogs
          // they open are the same ones — no second implementation.
          onBoost={onBoost}
          onEdit={onEdit}
        />
      )}
    </div>
  );
};
