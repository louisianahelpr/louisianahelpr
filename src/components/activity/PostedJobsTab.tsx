import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MapPin, SearchX, Wrench, X } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { hapticLight } from "@/lib/haptics";
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
  /**
   * Job id a `?job=` deep link resolved to, or null. Mirrors
   * AppliedJobsTab's `highlightAppId` — the poster side had no equivalent, so
   * the notification that says "your job X" landed on an unmarked list.
   */
  highlightJobId?: string | null;
  applicantCounts: Record<string, number>;
  expandedJobIds: Set<string>;
  toggleExpandedJobId: (id: string) => void;
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
  /** When true, render items grouped into collapsible Active /
   *  Completed / Cancelled sections instead of a flat list.
   *  Driven by the page-level "All" status filter. The page's
   *  outer header (ActivityHeader) is the sole source of truth for
   *  filter + search in both modes. */
  groupByStatus?: boolean;
  /** Active status filter key, its per-bucket counts, the filter labels, and
   *  the setter — all four only for the end-of-list block (see ListTail). The
   *  header above still owns the filter itself; this is a read of it. */
  statusFilter?: string;
  statusCounts?: Record<string, number>;
  statusLabels?: { key: string; label: string }[];
  onSelectStatusFilter?: (key: string) => void;
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
  return (
    <div
      className="flex items-start gap-2 rounded-ds-md px-3 py-2"
      style={{
        background: "hsl(var(--olivewood) / 0.07)",
        border: "0.5px solid hsl(var(--olivewood) / 0.20)",
      }}
    >
      <MapPin
        aria-hidden
        className="w-3.5 h-3.5 shrink-0 mt-0.5"
        style={{ color: "hsl(var(--olivewood))" }}
        strokeWidth={2.25}
      />
      <p
        className="flex-1 min-w-0 font-serif italic leading-snug text-ds-11"
        style={{ color: "hsl(var(--olivewood) / 0.9)" }}
      >
        <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
          Tap a card to open it.
        </span>{" "}
        Press and hold the location to get directions.
      </p>
      {/* 44px target on a 20px glyph — `-m-2.5` keeps the strip its own height
          while the hit area meets the app's floor. */}
      <button
        type="button"
        onClick={() => { hapticLight(); onDismiss(); }}
        aria-label="Dismiss tip about opening the map"
        className="shrink-0 -m-2.5 p-2.5 rounded-ds-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * The end of a SHORT list — the thing that stops half a screen reading as a bug.
 *
 * PageScaffold's panel is a fixed-height liquid-glass card, so the panel is
 * always as tall as the viewport whether the list has one card or twenty. With
 * one card the remaining ~426px at 375 (measured) was blank card stock running
 * down to the bottom nav: the owner's "roughly half the screen empty", and the
 * same complaint they had already raised on another screen — so it is treated
 * as a standing expectation, not a one-off.
 *
 * What fills it is deliberately NOT a second "Post a Task" button: the nav's
 * floating + is already that action, and a second glossy CTA a thumb-width away
 * is the two-competing-primaries defect. What a poster standing in a short
 * filtered view actually wants is the answer to "where are the rest of my
 * posts?" — so the tail says exactly that, and takes them there.
 *
 * The sentence and the jump-target are lifted from ActivityEmptyState's own
 * `filteredElsewhere` / `jumpTo` logic, so the short-list tail and the
 * empty-list state make the same claim in the same words rather than being two
 * people's idea of the same message.
 *
 * Renders NOTHING when there is nowhere to point (an "all" view, or every other
 * bucket empty) — an end-of-list block with no content is the void with a
 * border around it. In that case the tail is a plain flex spacer, which still
 * lets the list sit at the top of the panel rather than the middle.
 */
function ListTail({
  statusFilter,
  statusCounts,
  statusLabels,
  onSelectStatusFilter,
}: {
  statusFilter?: string;
  statusCounts?: Record<string, number>;
  statusLabels?: { key: string; label: string }[];
  onSelectStatusFilter?: (key: string) => void;
}) {
  const others = (statusLabels ?? []).filter(
    (f) =>
      f.key !== statusFilter && f.key !== "all" && (statusCounts?.[f.key] ?? 0) > 0,
  );
  // `mt-auto` on the spacer, not `flex-1` on the content: the copy stays a
  // normal-height block anchored to the BOTTOM of the panel, so a short list
  // reads as "list, then the footer of the screen" rather than as one card
  // floating in the middle of a box.
  if (!onSelectStatusFilter || others.length === 0) {
    return <div aria-hidden className="mt-auto" />;
  }
  const fullest = [...others].sort(
    (a, b) => (statusCounts?.[b.key] ?? 0) - (statusCounts?.[a.key] ?? 0),
  )[0];
  const activeLabel =
    (statusLabels ?? []).find((f) => f.key === statusFilter)?.label ?? "this view";
  const parts = others.map((f) => `${statusCounts?.[f.key]} in ${f.label}`);
  const elsewhere =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return (
    /* `flex-1` on BOTH the region and its panel, so the leftover height is
       CLAIMED rather than merely bounded. Bottom-anchoring the block alone (the
       first attempt) fixed the "the page just stops" reading but left an
       obvious blank band between the last card and the tail — the same void,
       now with a box under it. Letting the panel grow and centring its copy
       means there is no unclaimed pixel at any height: on a short list it is a
       calm end-of-list region, and on a list that fills the panel the free
       space is zero, so it collapses back to its content height and scrolls
       past like any other block.

       BUT THE CLAIM IS NOW CAPPED. Unbounded, "claim the leftover" turns into
       "inflate one sentence and one button to whatever is left": measured at
       500×900 with two short posts, the bordered box stood 363px tall around
       ~106px of content, and the thinner the bucket the worse it got — a
       single post gives it the better part of 500px. A bordered slab that size
       does not read as a calm region, it reads as the dead band it was meant
       to cure, only now outlined. `max-h-[9rem]` is the content's own ceiling
       (a three-line paragraph at 320px + the 44px button + the py-3 padding is
       121px), and `justify-end` on the wrapper hands the surplus BACK to the
       panel's own surface, where an unfilled panel is quiet, rather than
       painting a border around it. On a list that fills the panel nothing
       changes: there is no surplus to cap. */
    <div className="mt-auto flex-1 flex flex-col justify-end pt-6 min-h-0">
      <div
        className="rounded-ds-md px-3 py-3 text-center flex-1 max-h-[9rem] flex flex-col items-center justify-center"
        style={{
          background: "hsl(var(--olivewood) / 0.05)",
          border: "0.5px solid hsl(var(--olivewood) / 0.16)",
        }}
      >
        <p
          className="font-serif italic leading-snug text-ds-11 text-balance"
          style={{ color: "hsl(var(--olivewood) / 0.9)" }}
        >
          That's everything under{" "}
          <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
            {activeLabel}
          </span>
          . You also have {elsewhere}.
        </p>
        {/* Outline, never glossy — the nav's floating + owns this screen's one
            primary action, and a filled button here would compete with it. */}
        <Button
          size="sm"
          variant="outline"
          className="mt-2 rounded-ds-md btn-press min-h-[44px]"
          onClick={() => { hapticLight(); onSelectStatusFilter(fullest.key); }}
        >
          Show {fullest.label}
        </Button>
      </div>
    </div>
  );
}

export const PostedJobsTab = ({
  jobs, highlightJobId, applicantCounts, expandedJobIds, toggleExpandedJobId,
  helperNames, completedJobMeta,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onReport, onViewDispute, onConfirmArrival, confirmingArrivalJobId, onConfirmWorking, confirmingWorkingJobId,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onDeclineApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete, groupByStatus = false,
  statusFilter, statusCounts, statusLabels, onSelectStatusFilter,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();

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
        highlight={!!highlightJobId && highlightJobId === job.id}
        applicantCounts={applicantCounts}
        expandedJobIds={expandedJobIds}
        toggleExpandedJobId={toggleExpandedJobId}
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

       `gap-4` replaces the `space-y-4` this container used to carry, and that
       swap is load-bearing, not cosmetic: Tailwind compiles `space-y-4` to
       `.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem }`, whose
       specificity BEATS the `.mt-auto` utility — so with `space-y-4` on the
       parent, ListTail's `mt-auto` was silently overwritten by a 1rem margin
       and the tail stopped 245px short of the bottom (measured). A flex `gap`
       produces the identical rhythm without touching margins. */
    <div className="flex flex-col gap-4 flex-1">
      {/* Only with cards on screen to point at — see LocationPressHint. */}
      {!locationHintSeen && visibleJobs.length > 0 && (
        <LocationPressHint onDismiss={dismissLocationHint} />
      )}
      {listView}

      {/* Fills the panel's leftover height on a short list. */}
      <ListTail
        statusFilter={statusFilter}
        statusCounts={statusCounts}
        statusLabels={statusLabels}
        onSelectStatusFilter={onSelectStatusFilter}
      />

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
