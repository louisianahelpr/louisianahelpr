import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Check, SearchX, Star, Users, Wrench } from "lucide-react";
import { AttachmentLink } from "@/components/AttachmentLink";
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

  // Bulk-dismiss for cancelled posts — long-press a Cancelled card to
  // enter selection mode, then bulk-hide them from view. The hide is
  // local (sessionStorage) so the audit record on the server stays
  // intact.
  const bulkDismiss = useBulkDismiss("posted");

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
              /* Loading state — skeleton applicant rows (matching the real
                 card silhouette) instead of a bare spinner, so the wait
                 reads as "content arriving" and is consistent with every
                 other list's loading treatment. */
              <div className="space-y-3" aria-label="Loading applicants" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-ds-md bg-card p-3 flex items-center gap-3"
                    style={{ border: "0.5px solid hsl(var(--olivewood) / 0.12)" }}
                  >
                    <Skeleton className="w-11 h-11 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                    <Skeleton className="h-8 w-16 rounded-ds-sm shrink-0" />
                  </div>
                ))}
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
                body="When helprs apply to this task, they'll show up here for you to review. Sharing it reaches more helprs nearby."
                action={
                  selectedJob ? (
                    <ShareJobButton
                      job={{ id: selectedJob.id, title: selectedJob.title, budget: selectedJob.budget, category: selectedJob.category }}
                    />
                  ) : undefined
                }
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
                      {/* Application-status pills — rounded-ds-pill + dot matches
                          the StatusBadge visual system for consistency. */}
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
    </div>
  );
};
