import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Check, SearchX, Sparkles, Star, Users, Wrench } from "lucide-react";
import { AttachmentLink } from "@/components/AttachmentLink";
import { scoreApplicant, type ApplicantData } from "@/lib/applicantScoring";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { VirtualList } from "@/components/VirtualList";
import { type Job, type EnrichedApplication } from "./activityConstants";
import { PostedJobCard } from "./PostedJobCard";
import { ActivitySectionedView } from "@/pages/activity/ActivitySectionedView";
import { bucketPostedJob } from "@/pages/activity/activityFilters";
import { useBulkDismiss } from "@/pages/activity/useBulkDismiss";
import { BulkDismissBar } from "@/pages/activity/BulkDismissBar";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium } from "@/lib/haptics";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * BulkDismissibleWrapper — when selectionMode is off, presses are
 * forwarded to the underlying card as usual EXCEPT for the long-press
 * which enters selection mode. When selectionMode is on, taps toggle
 * selection and the card's own interactions are intercepted (a thin
 * overlay swallows pointer events) so the user can multi-select
 * without accidentally triggering the card's own actions.
 */
interface BulkDismissibleWrapperProps {
  selectionMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onTapInSelection: () => void;
  children: React.ReactNode;
}

function BulkDismissibleWrapper({
  selectionMode,
  selected,
  onLongPress,
  onTapInSelection,
  children,
}: BulkDismissibleWrapperProps) {
  const longPressProps = useLongPress({
    threshold: 500,
    onLongPress: () => {
      hapticMedium();
      onLongPress();
    },
  });

  return (
    <div
      // Don't add long-press while already in selection mode — taps
      // should toggle selection cleanly without an additional 500ms hold.
      {...(selectionMode ? {} : longPressProps)}
      className="relative"
      style={{ touchAction: selectionMode ? "manipulation" : undefined }}
    >
      {/* Selection overlay — only active in selection mode. Captures
          taps to toggle and renders a checkbox in the corner. The
          overlay sits above the card content so clicks on links/buttons
          inside the card are blocked while selecting. */}
      {selectionMode && (
        <button
          type="button"
          onClick={onTapInSelection}
          aria-pressed={selected}
          aria-label={selected ? "Deselect this post" : "Select this post"}
          className="absolute inset-0 z-10 rounded-ds-md transition"
          style={{
            background: selected
              ? "hsl(var(--bark) / 0.18)"
              : "hsl(var(--olivewood) / 0.04)",
            border: selected
              ? "1.5px solid hsl(var(--bark))"
              : "1.5px solid hsl(var(--olivewood) / 0.2)",
          }}
        >
          {/* Checkbox glyph — top-right so it doesn't fight the avatar
              or title-bar that anchors the card on the left. */}
          <span
            className="absolute top-3 right-3 w-6 h-6 rounded-full inline-flex items-center justify-center"
            style={{
              background: selected ? "hsl(var(--bark))" : "hsl(var(--parchment))",
              border: selected
                ? "1.5px solid hsl(var(--bark))"
                : "1.5px solid hsl(var(--olivewood) / 0.35)",
              boxShadow: "0 1px 3px hsl(var(--olivewood) / 0.18)",
            }}
            aria-hidden="true"
          >
            {selected && <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />}
          </span>
        </button>
      )}
      {children}
    </div>
  );
}

interface PostedJobsTabProps {
  jobs: Job[];
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
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
  onConfirmStart: (jobId: string) => void;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
  onLoadApplications: (job: Job) => void;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  /** True while the full-screen applicants fetch is in-flight. */
  applicationsLoading?: boolean;
  /** True when the full-screen applicants fetch failed. */
  applicationsError?: boolean;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  applicantErrors: Record<string, boolean>;
  /** Refetch the feed after an inline card mutation (e.g. dispute action). */
  onActionComplete: () => void;
  /** When true, render items grouped into collapsible Active /
   *  Completed / Cancelled sections instead of a flat virtualized
   *  list. Driven by the page-level "All" status filter. The page's
   *  outer header (ActivityHeader) is the sole source of truth for
   *  filter + search in both modes. */
  groupByStatus?: boolean;
}

export const PostedJobsTab = ({
  jobs, applicantCounts, expandedJobId, setExpandedJobId,
  helperNames, completedJobMeta, startRequestedJobIds,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onViewDispute, onConfirmStart, onConfirmArrival, onConfirmWorking,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete, groupByStatus = false,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();

  // Sort order for the applicants comparison panel.
  // "recommended" = multi-factor score desc (default)
  // "rated"       = avgRating desc, then reviewCount desc
  // "soonest"     = created_at asc (first to apply)
  const [applicantSort, setApplicantSort] = useState<"recommended" | "rated" | "soonest">("recommended");

  // Bulk-dismiss for cancelled posts — long-press a Cancelled card to
  // enter selection mode, then bulk-hide them from view. The hide is
  // local (sessionStorage) so the audit record on the server stays
  // intact.
  const bulkDismiss = useBulkDismiss("posted");

  // Neighbor hire counts — one RPC call per applicant, keyed by helper_id.
  // Runs only when the selected job has coordinates (many jobs have
  // approximate coords from geocoding at post time). Falls back to 0
  // on PGRST202 (function not yet deployed) or any other error so the
  // panel is never blocked by the trust-graph migration.
  const neighborCountQueries = useQueries({
    queries: applications.map((app) => ({
      queryKey: ["neighbor-count", app.helper_id, selectedJob?.latitude, selectedJob?.longitude],
      queryFn: async (): Promise<number> => {
        if (!selectedJob?.latitude || !selectedJob?.longitude) return 0;
        try {
          const { data, error } = await supabase.rpc("get_neighbor_hire_count", {
            p_helper_id: app.helper_id,
            p_lat: selectedJob.latitude,
            p_lng: selectedJob.longitude,
          });
          if (error) return 0;
          return (data as number) ?? 0;
        } catch {
          return 0; // PGRST202 or network error — degrade gracefully
        }
      },
      staleTime: 300_000, // 5 min — neighborhood data is slow-moving
      enabled: !!selectedJob?.latitude && !!selectedJob?.longitude,
    })),
  });

  // Map helper_id → neighbor count for O(1) lookup in scoring + rendering.
  const neighborCountMap = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app, i) => {
      map.set(app.helper_id, neighborCountQueries[i]?.data ?? 0);
    });
    return map;
  }, [applications, neighborCountQueries]);

  // Build scored + sorted applicant list for the comparison panel.
  // Scoring is purely client-side — no extra queries needed.
  // The score map is keyed by helper_id so the "Recommended" badge
  // can identify the top pick in O(1).
  const { sortedApplications, scoreMap } = useMemo(() => {
    type ScoredApp = { app: EnrichedApplication; score: number; signals: string[]; neighborCount: number };
    if (applications.length === 0) return { sortedApplications: [] as ScoredApp[], scoreMap: new Map<string, number>() };

    const map = new Map<string, number>();
    const scored = applications.map((app) => {
      // Map EnrichedApplication fields onto ApplicantData — pass null
      // for fields the current query doesn't return so the scoring
      // function skips those dimensions gracefully.
      const tier = app.profiles?.subscription_tier;
      // subscription_tier ("elite"=3, "pro"=2, "basic"=1, else 0) is
      // the closest proxy for credentialTier available without a migration.
      const credentialTier = tier === "elite" ? 3 : tier === "pro" ? 2 : tier === "basic" ? 1 : 0;
      const neighborCount = neighborCountMap.get(app.helper_id) ?? 0;
      const data: ApplicantData = {
        userId: app.helper_id,
        avgRating: app.avgRating ?? null,
        reviewCount: app.reviewCount ?? 0,
        completedJobs: 0,       // not returned by get_safe_profiles yet
        repeatHirePercent: null, // not available without migration
        onTimePercent: null,     // not available without migration
        credentialTier,
        distanceKm: null,        // not available in this context
        responseTimeMinutes: null,
        neighborCount,           // live from get_neighbor_hire_count RPC
      };
      const result = scoreApplicant(data);
      map.set(app.helper_id, result.score);
      return { app, score: result.score, signals: result.signals, neighborCount };
    });

    const sorted = [...scored];
    if (applicantSort === "recommended") {
      sorted.sort((a, b) => b.score - a.score);
    } else if (applicantSort === "rated") {
      sorted.sort((a, b) => {
        const ratingDiff = (b.app.avgRating ?? 0) - (a.app.avgRating ?? 0);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.app.reviewCount ?? 0) - (a.app.reviewCount ?? 0);
      });
    } else {
      // "soonest" = first to apply (ascending created_at)
      sorted.sort((a, b) => a.app.created_at.localeCompare(b.app.created_at));
    }

    return { sortedApplications: sorted, scoreMap: map };
  }, [applications, applicantSort]);

  // The top recommended applicant — used to render the badge.
  const topHelperIdByScore = useMemo(() => {
    if (applications.length === 0) return null;
    let topId: string | null = null;
    let topScore = -Infinity;
    scoreMap.forEach((score, id) => {
      if (score > topScore) { topScore = score; topId = id; }
    });
    return topId;
  }, [applications, scoreMap]);

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
  // VirtualList view and the grouped Sectioned view paint identical
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
        startRequestedJobIds={startRequestedJobIds}
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
        onConfirmStart={onConfirmStart}
        onConfirmArrival={onConfirmArrival}
        onConfirmWorking={onConfirmWorking}
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
        body="Post your first task and we'll match you with ID-verified Louisiana helprs nearby."
        action={
          <Button onClick={() => navigate("/post-job")} className="rounded-ds-md btn-press">
            <Wrench className="w-4 h-4 mr-1.5" /> Post a job
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
    <VirtualList
      items={visibleJobs}
      getKey={(job) => job.id}
      estimateSize={260}
      overscan={4}
      className="space-y-0"
      itemClassName="pb-3"
      renderItem={renderJobCard}
    />
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
        <div className="fixed inset-0 z-50 flex flex-col animate-in slide-in-from-right duration-200" style={{ background: "hsl(var(--parchment))" }}>
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{
              borderBottom: "0.5px solid hsl(var(--bark) / 0.12)",
              background: "hsla(0, 0%, 100%, 0.72)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              className="btn-press -ml-1 h-9 w-9 p-0 shrink-0"
              aria-label="Back to posted jobs"
              onClick={() => setSelectedJob(null)}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2
                className="font-display italic font-bold leading-tight truncate"
                style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                Applicants
              </h2>
              <p className="text-ds-11 font-serif italic truncate" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                {selectedJob.title}
              </p>
            </div>
          </div>

          {/* Modal body — capped at iPad-comfortable width */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-2xl mx-auto w-full">
              {applicationsLoading ? (
                /* Loading: 2 skeleton cards matching the real card height */
                <div className="space-y-3" aria-label="Loading applicants" aria-busy="true">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="rounded-ds-md p-3.5 flex items-start gap-3"
                      style={{
                        backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "0.5px solid hsl(var(--bark) / 0.18)",
                      }}
                    >
                      <Skeleton className="w-11 h-11 rounded-full shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-3 w-3/5" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="h-9 w-16 rounded-ds-sm shrink-0" />
                    </div>
                  ))}
                </div>
              ) : applicationsError ? (
                /* Error state */
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground text-ds-15">Couldn't load applicants</p>
                    <p className="text-ds-13 text-muted-foreground">Check your connection and try again.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-ds-md btn-press"
                    onClick={() => onLoadApplications(selectedJob)}
                  >
                    Retry
                  </Button>
                </div>
              ) : applications.length === 0 ? (
                /* Empty state — warmer copy when no one has applied yet */
                <div className="flex flex-col items-center text-center gap-5 pt-12 pb-6 px-6">
                  <div
                    className="w-14 h-14 rounded-full inline-flex items-center justify-center"
                    style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
                  >
                    <Users className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1.5">
                    <p
                      className="font-display italic font-bold"
                      style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      No one has applied yet
                    </p>
                    <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Your job was just posted! Sharing it reaches more helprs nearby.
                    </p>
                  </div>
                  <ShareJobButton
                    job={{ id: selectedJob.id, title: selectedJob.title, budget: selectedJob.budget, category: selectedJob.category }}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* Sort control — horizontal pill row */}
                  <div className="flex items-center gap-1.5 mb-4" role="group" aria-label="Sort applicants by">
                    {(["recommended", "rated", "soonest"] as const).map((opt) => {
                      const label = opt === "recommended" ? "Recommended" : opt === "rated" ? "Highest rated" : "Soonest available";
                      const active = applicantSort === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setApplicantSort(opt)}
                          aria-pressed={active}
                          className="px-3 py-1.5 rounded-full text-ds-11 font-sans font-semibold transition-all duration-150 active:scale-95"
                          style={{
                            background: active ? "hsl(var(--bark) / 0.10)" : "hsla(0, 0%, 100%, 0.45)",
                            color: active ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.6)",
                            border: active
                              ? "0.5px solid hsl(var(--bark) / 0.3)"
                              : "0.5px solid hsl(var(--bark) / 0.12)",
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Applicant cards */}
                  {sortedApplications.map(({ app, signals, neighborCount }) => {
                    const helperTier = (app.profiles?.subscription_tier ?? "free") as string;
                    const isElite = helperTier === "elite";
                    const isPro = helperTier === "pro";
                    const haloColor = isElite
                      ? "hsl(var(--gold-warm))"
                      : isPro
                        ? "hsl(var(--burnt-sienna))"
                        : null;
                    const helperName = formatName(app.profiles?.full_name, "Helpr");
                    const helperInitials = helperName
                      .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
                    const isTopPick = applicantSort === "recommended" && app.helper_id === topHelperIdByScore && applications.length > 1;
                    // Show up to 3 trust signals as inline text (scoring signals
                    // already include the neighbor signal when neighborCount > 0)
                    const visibleSignals = signals.slice(0, 3);

                    return (
                      <div key={app.id}>
                        {/* "Helpr Recommended" badge above the top pick */}
                        {isTopPick && (
                          <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                            <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))" }} />
                            <span
                              className="text-ds-10 font-sans font-semibold uppercase"
                              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.06em" }}
                            >
                              Helpr Recommended
                            </span>
                          </div>
                        )}

                        {/* Compact applicant card */}
                        <div
                          className="rounded-ds-md p-3.5 space-y-2.5"
                          style={{
                            backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                            backdropFilter: "blur(16px)",
                            WebkitBackdropFilter: "blur(16px)",
                            border: isTopPick
                              ? "0.5px solid hsl(var(--burnt-sienna) / 0.30)"
                              : "0.5px solid hsl(var(--bark) / 0.18)",
                            boxShadow: isTopPick
                              ? "0 0 0 2px hsl(var(--burnt-sienna) / 0.08), inset 0 1px 1px 0 rgba(255,255,255,0.55)"
                              : "inset 0 1px 1px 0 rgba(255,255,255,0.55)",
                          }}
                        >
                          {/* Row 1: avatar + name + rating + hire button */}
                          <div className="flex items-center gap-3">
                            <a
                              href={`/user/${app.helper_id}`}
                              className="shrink-0 w-11 h-11 rounded-full overflow-hidden inline-flex items-center justify-center"
                              style={{
                                background: "hsl(var(--bark) / 0.12)",
                                boxShadow: haloColor
                                  ? `0 0 0 2.5px ${haloColor}`
                                  : "0 0 0 1px hsl(var(--olivewood) / 0.18)",
                              }}
                            >
                              {app.profiles?.avatar_url ? (
                                <OptimizedImage
                                  src={app.profiles.avatar_url}
                                  width={44}
                                  height={44}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="font-display italic font-bold text-[0.85rem]" style={{ color: "hsl(var(--bark))" }}>
                                  {helperInitials}
                                </span>
                              )}
                            </a>

                            <div className="flex-1 min-w-0">
                              {/* Name + tier badge */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <a
                                  href={`/user/${app.helper_id}`}
                                  className="font-display italic font-bold truncate hover:underline"
                                  style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                                >
                                  {helperName}
                                </a>
                                {isElite && (
                                  <span
                                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{
                                      background: "hsl(var(--gold-warm) / 0.14)",
                                      color: "hsl(var(--gold-warm))",
                                      letterSpacing: "0.08em",
                                    }}
                                  >
                                    Elite
                                  </span>
                                )}
                                {isPro && (
                                  <span
                                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{
                                      background: "hsl(var(--burnt-sienna) / 0.12)",
                                      color: "hsl(var(--burnt-sienna))",
                                      letterSpacing: "0.08em",
                                    }}
                                  >
                                    Pro
                                  </span>
                                )}
                                {/* Inline rating — compact ★ 4.9 (23) */}
                                {(app.reviewCount ?? 0) > 0 && (
                                  <span className="flex items-center gap-0.5 shrink-0">
                                    <Star
                                      className="w-3 h-3"
                                      style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }}
                                    />
                                    <span className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                                      {(app.avgRating ?? 0).toFixed(1)}{" "}
                                      <span style={{ color: "hsl(var(--olivewood) / 0.55)" }}>({app.reviewCount})</span>
                                    </span>
                                  </span>
                                )}
                              </div>
                              {/* Trust signals row */}
                              {visibleSignals.length > 0 && (
                                <p
                                  className="font-serif italic mt-0.5 leading-snug"
                                  style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.68)" }}
                                >
                                  {visibleSignals.join(" · ")}
                                </p>
                              )}
                              {/* Neighborhood trust signal — shown standalone
                                  when > 0 neighbors hired this helper near
                                  the job address (from get_neighbor_hire_count RPC).
                                  Uses bark color so it reads as a warm local signal
                                  distinct from the neutral olivewood signals above. */}
                              {neighborCount > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans font-semibold"
                                  style={{ color: "hsl(var(--bark))" }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "hsl(var(--bark))" }}
                                    aria-hidden="true"
                                  />
                                  {neighborCount} neighbor{neighborCount > 1 ? "s" : ""} hired them
                                </span>
                              )}
                            </div>

                            {/* Status / hire button */}
                            {app.status === "pending" && (
                              <Button
                                variant="bark"
                                size="sm"
                                className="rounded-ds-md btn-press shrink-0"
                                aria-label={`Select ${helperName}`}
                                onClick={() => onAcceptApplication(app)}
                              >
                                Hire
                              </Button>
                            )}
                            {app.status === "accepted" && (
                              <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]">
                                <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--bark))]" aria-hidden="true" />
                                Selected
                              </span>
                            )}
                            {app.status === "rejected" && (
                              <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.7)]">
                                <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--olivewood)/0.7)]" aria-hidden="true" />
                                Declined
                              </span>
                            )}
                          </div>

                          {/* Row 2: applicant message — compact quote style */}
                          {app.message && (
                            <p
                              className="font-serif italic text-ds-13 leading-snug line-clamp-2 pl-14"
                              style={{ color: "hsl(var(--ink-deep) / 0.72)" }}
                            >
                              "{app.message}"
                            </p>
                          )}

                          {/* Row 3: attachments */}
                          {(app.attachment_urls || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-14">
                              {(app.attachment_urls || [] as string[]).map((url: string, i: number) => {
                                const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                                return (
                                  <AttachmentLink
                                    key={i}
                                    url={url}
                                    index={i}
                                    variant={isImage ? "thumb" : "chip"}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
