import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Check, Loader2, Play, SearchX, Sparkles, Star, Users, Wrench, X } from "lucide-react";
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
import { ListFilterBar, type StatusChip } from "./ListFilterBar";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Status chips for the poster's jobs list — collapses the seven raw
 *  job-status enum values into the four states a poster thinks in. */
const POSTED_STATUS_CHIPS: StatusChip[] = [
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
];

/** Bucket a job into one of the chip values above. */
function postedBucket(job: Job): string {
  switch (job.status) {
    case "open": return "open";
    case "completed": return "completed";
    case "cancelled":
    case "disputed": return "closed";
    default: return "active"; // accepted / in_progress / revision_requested
  }
}

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
      {...(selectionMode ? {} : longPressProps)}
      className="relative"
      style={{ touchAction: selectionMode ? "manipulation" : undefined }}
    >
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
  /** When true, jobs are rendered in a 3-section grouped shell (Open /
   *  Active / Completed–Closed) instead of a flat list. Driven by the
   *  page-level "All" status filter. */
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
  // Client-side search + status filter over the already-loaded list.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Video preview modal — stores the URL of the video currently playing.
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== "all" && postedBucket(job) !== statusFilter) return false;
      if (!q) return true;
      return (
        (job.title ?? "").toLowerCase().includes(q) ||
        (job.category ?? "").toLowerCase().includes(q) ||
        (job.location ?? "").toLowerCase().includes(q)
      );
    });
  }, [jobs, searchQuery, statusFilter]);

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
          const { data, error } = await (supabase.rpc as any)("get_neighbor_hire_count", {
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
        stakeAmount: (app as any).stake_amount ?? null,
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
        body="Post your first task and we'll match you with vetted Louisiana helprs nearby."
        action={
          <Button onClick={() => navigate("/post-job")} className="rounded-ds-md btn-press">
            <Wrench className="w-4 h-4 mr-1.5" /> Post a job
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <ListFilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        chips={POSTED_STATUS_CHIPS}
        searchPlaceholder="Search your posts…"
      />

      {filteredJobs.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={SearchX}
          title="No matches in this view"
          body="Nothing here fits that search or filter yet — try a different word or clear the filter to see everything."
        />
      ) : (
      <VirtualList
        items={filteredJobs}
        getKey={(job) => job.id}
        estimateSize={260}
        overscan={4}
        className="space-y-0"
        itemClassName="pb-3"
        renderItem={(job) => (
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
        )}
      />
      )}

      {/* Applicants full-screen view */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card">
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
              <h2 className="font-display font-semibold text-foreground truncate">Applicants</h2>
              <p className="text-ds-11 text-muted-foreground truncate">{selectedJob.title}</p>
            </div>
          </div>
          {/* Modal body — capped at iPad-comfortable width so it doesn't
              stretch wall-to-wall on large screens. */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-2xl mx-auto w-full">
            {applicationsLoading ? (
              /* Loading state — prevents a blank modal from masquerading
                 as "no applicants" while the fetch is in-flight. */
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin" />
                <p className="text-ds-13">Loading applicants…</p>
              </div>
            ) : applicationsError ? (
              /* Error state — surface the failure clearly so the poster
                 knows to retry rather than concluding there are no applicants. */
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
              <EmptyState
                variant="inline"
                icon={Users}
                title="No applications yet"
                body="When helprs apply to this task, they'll show up here for you to review."
              />
            ) : (
              <div className="space-y-3">
                {applications.map((app) => {
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
                  return (
                  <div key={app.id} className="p-4 rounded-ds-md liquid-glass space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      {/* Avatar with Pro/Elite halo ring — gold for Elite,
                          sienna for Pro, no ring for free helpers. Makes
                          subscribed applicants pop in the poster's review. */}
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
                            // Helper avatar renders into a fixed 44px (w-11 h-11)
                            // circle — request a matching thumbnail via the
                            // Vercel edge (AVIF/WebP) on web.
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
                          {/* Intro video play icon — only shows when the
                              helper has uploaded a 60s intro video. */}
                          {app.profiles?.intro_video_url && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setPlayingVideoUrl(app.profiles!.intro_video_url!);
                              }}
                              aria-label="Play intro video"
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 active:opacity-70 transition-opacity shrink-0"
                              style={{
                                background: "hsl(var(--burnt-sienna) / 0.08)",
                              }}
                            >
                              <Play className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
                              <span className="text-[8px] font-semibold" style={{ color: "hsl(var(--burnt-sienna))" }}>Intro</span>
                            </button>
                          )}
                        </div>
                        {app.profiles?.skills && (
                          <p className="font-serif italic mt-0.5 line-clamp-1" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.75)" }}>
                            {app.profiles.skills}
                          </p>
                        )}
                        {app.reviewCount !== undefined && app.reviewCount > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <Star className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
                            <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                              {app.avgRating?.toFixed(1)} ({app.reviewCount} review{app.reviewCount === 1 ? "" : "s"})
                            </span>
                          </div>
                        )}
                      </div>
                      {app.status === "pending" && (
                        <Button
                          variant="bark"
                          size="sm"
                          className="rounded-ds-md btn-press shrink-0"
                          aria-label={`Select ${helperName}`}
                          onClick={() => onAcceptApplication(app)}
                        >
                          Select
                        </Button>
                      )}
                      {app.status === "accepted" && <span className="text-ds-11 px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Selected</span>}
                      {app.status === "rejected" && <span className="text-ds-11 px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive">Declined</span>}
                    </div>

                    {/* Applicant message */}
                    {app.message && (
                      <div className="rounded-ds-sm bg-primary/5 border border-primary/15 p-3">
                        <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-1">Their Message</p>
                        <p className="text-ds-13 text-foreground leading-relaxed">{app.message}</p>
                      </div>
                    )}

                    {/* Applicant attachments */}
                    {(app.attachment_urls || []).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide">Attached Files</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(app.attachment_urls || []).map((url, i) => {
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
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Video modal — shown when poster taps a helper's intro video pill */}
      {playingVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
          onClick={() => setPlayingVideoUrl(null)}
        >
          <button
            type="button"
            aria-label="Close video"
            onClick={() => setPlayingVideoUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)" }}
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <video
            src={playingVideoUrl}
            controls
            autoPlay
            playsInline
            className="w-full max-w-sm rounded-ds-md max-h-[70dvh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
