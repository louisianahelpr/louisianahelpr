import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Loader2, SearchX, Star, Users, Wrench } from "lucide-react";
import { AttachmentLink } from "@/components/AttachmentLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { VirtualList } from "@/components/VirtualList";
import { type Job, type EnrichedApplication } from "./activityConstants";
import { PostedJobCard } from "./PostedJobCard";
import { ListFilterBar, type StatusChip } from "./ListFilterBar";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";

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
}

export const PostedJobsTab = ({
  jobs, applicantCounts, expandedJobId, setExpandedJobId,
  helperNames, completedJobMeta, startRequestedJobIds,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onConfirmStart, onConfirmArrival, onConfirmWorking,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();
  // Client-side search + status filter over the already-loaded list.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
    </div>
  );
};
