import { memo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustRow } from "@/components/TrustRow";
import { SaveHelperButton } from "@/components/SaveHelperButton";
import { CompletionChoiceSheet } from "@/components/activity/CompletionChoiceSheet";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { successToast } from "@/lib/toast";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
  MapPin, DollarSign, XCircle, CheckCircle2, RotateCcw, Star, MessageSquare,
  Users, Pencil, AlertTriangle, RefreshCw, Rocket, Clock, Wrench,
  RotateCw, Check, ChevronDown, ChevronUp, Ban, Zap, Eye, Send, X, ChevronRight,
} from "lucide-react";
import { differenceInHours } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { parseLocalDate } from "@/lib/dateUtils";
import { type Job, type EnrichedApplication } from "./activityConstants";
import {
  EscrowProgressBar,
  deriveEscrowStepFromJob,
} from "@/components/payment/EscrowProgressBar";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { IncomingReportCard } from "./PetReportCard";

/** Bid column added by a later migration not yet regenerated into the
    Supabase types (PGRST202 migration-lag pattern — see CLAUDE.md).
    Optional: absent on a production DB where the migration hasn't run. */
type WithBidPrice = { proposed_price?: number | null };

interface PostedJobCardProps {
  /** The job + its embedded data — one row of the posted feed. */
  job: Job;
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
  userId: string;
  /** Job-lifecycle handlers, owned by the parent ActivityTab. */
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
  /** Inline applicant data for the expanded open-job card. */
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  /** Per-job applicant fetch error, for inline retry. */
  applicantErrors: Record<string, boolean>;
  /** Pre-fetched latest tracking row for this job, threaded down to
      <JobTracking> so the card doesn't fire its own SELECT on mount.
      `null` = pre-fetched and no row exists yet; `undefined` = not
      pre-fetched (the child falls back to its own per-mount query). */
  initialTracking?: TrackingData | null;
  /** Pre-fetched group-helper rows for this job (only relevant for active
      group jobs), threaded into <GroupJobHelpers> to skip its own 2-query
      waterfall on mount. */
  initialGroupHelpers?: GroupHelperLite[];
  /** Refetch the posted-jobs feed after an inline mutation (dispute
      resolve/escalate) instead of a full-page reload. */
  onActionComplete: () => void;
  /** Number of unique helprs who have viewed this job. Only shown when > 0. */
  viewCount?: number;
  /** Pre-computed analytics for this job — views, applicant count,
   *  conversion rate, and bid range (bid fields only for accept_bids jobs). */
  jobAnalytics?: {
    viewCount: number;
    applicantCount: number;
    conversionRate: number | null;
    bidMin: number | null;
    bidMax: number | null;
    bidAvg: number | null;
  };
}

/**
 * PostedJobCard — one card in the poster's "my posts" feed: the job
 * summary plus the state-specific section (open / accepted / in-progress
 * / revision / completed / disputed) and its actions.
 *
 * Extracted verbatim from PostedJobsTab.tsx (a 929-line file whose bulk
 * was this one render function). Faithful relocation — the JSX is
 * unchanged; every value the card read from the parent is now a prop.
 */
function PostedJobCardInner({
  job,
  applicantCounts,
  expandedJobId,
  setExpandedJobId,
  helperNames,
  completedJobMeta,
  startRequestedJobIds,
  userId,
  onBoost,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  onRevision,
  onNoShow,
  onTip,
  onReview,
  onDispute,
  onViewDispute,
  onConfirmStart,
  onConfirmArrival,
  onConfirmWorking,
  onLoadApplications,
  onLoadInlineApplicants,
  inlineApplicants,
  loadingApplicants,
  applicantErrors,
  initialTracking,
  initialGroupHelpers,
  onActionComplete,
  viewCount,
  jobAnalytics,
}: PostedJobCardProps) {
  const navigate = useNavigate();
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  // Broadcast boost state — tracks whether a notification blast has been
  // sent for this job in the current session so the button disables after
  // one tap (until the page refreshes). Separate from the paid "Boost"
  // (create-boost-payment) which controls feed ranking.
  const [broadcastBoosted, setBroadcastBoosted] = useState(false);
  const [broadcastBoosting, setBroadcastBoosting] = useState(false);

  // "Message all applicants" compose state — inline below the applicant list.
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const broadcastRef = useRef<HTMLTextAreaElement>(null);
  // Guards the Mark Resolved / Escalate to Admin buttons while their
  // supabase UPDATE is in-flight — prevents double-tap submission.
  const [disputeActing, setDisputeActing] = useState(false);

  /**
   * handleBroadcastMessage — inserts one message row per pending applicant
   * into the `messages` table, targeting their per-applicant conversation
   * thread with the poster (keyed by job_id + participant pair). Each
   * insert uses the poster's userId as sender_id and the applicant's
   * helper_id as receiver_id, matching the schema used by the ChatView.
   * Errors are surfaced individually; a partial failure still shows the
   * success count so the poster knows which sends went through.
   */
  const handleBroadcastMessage = async () => {
    if (!broadcastText.trim() || broadcastSending) return;
    const pendingApplicants = (inlineApplicants[job.id] ?? []).filter(
      (a) => a.status === "pending",
    );
    if (pendingApplicants.length === 0) return;

    setBroadcastSending(true);
    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      pendingApplicants.map(async (app) => {
        const { error } = await supabase.from("messages").insert({
          job_id: job.id,
          sender_id: userId,
          receiver_id: app.helper_id,
          content: broadcastText.trim(),
        });
        if (error) {
          failCount++;
          report(error, { tags: { source: "PostedJobCard.broadcastMessage", jobId: job.id } });
        } else {
          successCount++;
          // Notify the helper so they see the message in their inbox.
          void createNotification({
            user_id: app.helper_id,
            title: "New message from poster",
            message: broadcastText.trim().slice(0, 120),
            type: "info",
            link: `/messages`,
          });
        }
      }),
    );

    setBroadcastSending(false);

    if (successCount > 0) {
      hapticSuccess();
      successToast(
        `Message sent to ${successCount} helpr${successCount !== 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`,
      );
      setBroadcastOpen(false);
      setBroadcastText("");
    } else {
      hapticError();
      toast.error("Couldn't send the message — please try again.");
    }
  };

  /**
   * handleBroadcastBoost — invoke boost-job edge function to send a
   * targeted push notification to nearby helpers. PGRST202 (function not
   * yet deployed) is handled silently. Other errors show a toast.
   */
  const handleBroadcastBoost = async () => {
    if (broadcastBoosting || broadcastBoosted) return;
    setBroadcastBoosting(true);
    try {
      const { data, error } = await supabase.functions.invoke("boost-job", {
        body: { jobId: job.id },
      });
      // PGRST202 = function not yet deployed — silently hide the button.
      if (error) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("PGRST202") || msg.includes("not found") || msg.includes("404")) {
          // Edge function not deployed yet — silently suppress
          setBroadcastBoosted(true);
          return;
        }
        // Surface the function's real reason (e.g. "Already boosted in the
        // last 24 hours") instead of the generic "non-2xx status code".
        throw new Error(await functionErrorMessage(error, "Couldn't send boost notification. Try again."));
      }
      // boost-job returns an untyped JSON body; narrow the fields we read.
      const boostData = data as { error?: string; notified?: number } | null;
      if (boostData?.error) {
        throw new Error(boostData.error);
      }
      const notified: number = boostData?.notified ?? 0;
      setBroadcastBoosted(true);
      successToast(
        notified > 0
          ? `Job boosted! ${notified} nearby helpr${notified !== 1 ? "s" : ""} were notified.`
          : "Job boosted! Nearby helprs were notified.",
      );
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't send boost notification. Try again.");
    } finally {
      setBroadcastBoosting(false);
    }
  };
  const meta = completedJobMeta[job.id];
  const isFullyCompleted = job.status === "completed" && meta?.tipped && meta?.reviewed;
  const isExpanded = expandedJobId === job.id;
  // Escrow progress lives above the action area — context, not a CTA.
  // Returns null for pre-paid / cancelled jobs so the bar hides cleanly
  // when escrow doesn't apply.
  const escrowStep = deriveEscrowStepFromJob(job);
  return (
          <JobCardShell
            expandable={isFullyCompleted}
            expanded={isExpanded}
            onToggle={() => setExpandedJobId(isExpanded ? null : job.id)}
            // scroll-mt keeps a card's title from ghosting up under the
            // translucent (~0.85 opacity) page title card when it scrolls
            // to the top of the list.
            className="group relative scroll-mt-3"
          >
            <JobCardTitleBar title={job.title} amount={String(job.budget)} />

            {/* Escrow progress — high-context status of the customer's
                payment for this job. Sits above the action area (below
                the title bar) so the poster reads it before any CTAs.
                Hides itself when escrow does not apply. */}
            {escrowStep && (
              <div className="px-4 pt-3" onClick={(e) => e.stopPropagation()}>
                <EscrowProgressBar currentStep={escrowStep} compact />
              </div>
            )}

            {/* Summary */}
            <div className="px-4 py-3 space-y-2.5">
              <JobCardMetaRow
                dateNeeded={job.date_needed}
                startTime={job.start_time}
                flexibleLabel="Flexible time"
                location={job.location}
                latitude={job.latitude}
                longitude={job.longitude}
                estimatedHours={job.estimated_hours}
                expiresAt={!job.helper_id ? job.expires_at : null}
              >
                {(applicantCounts[job.id] || 0) > 0 && job.status === "open" && (
                  <span className="flex items-center gap-1 text-primary font-medium"><Users className="w-3 h-3 shrink-0" /> {applicantCounts[job.id]} applicant{applicantCounts[job.id] !== 1 ? "s" : ""}</span>
                 )}
                 {viewCount != null && viewCount > 0 && (
                   <span className="flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                     <Eye className="w-3 h-3 shrink-0" />
                     {viewCount} {viewCount === 1 ? "view" : "views"}
                   </span>
                 )}
                 {job.is_recurring && (
                   <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 shrink-0 text-primary" /> {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}</span>
                 )}
                 {job.is_group_job && (
                   <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} helper${job.helpers_needed === 1 ? "" : "s"}` : "Group task"}</span>
                 )}
               </JobCardMetaRow>
            {(job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() || job.special_requirements?.trim()) && (
              <div className="space-y-1.5">
                {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
                  <p className={`text-ds-11 text-muted-foreground leading-relaxed ${isExpanded ? "" : "line-clamp-2"}`}>{job.description}</p>
                )}
                {isExpanded && job.special_requirements?.trim() && (
                  <div className="rounded-ds-sm bg-secondary/30 p-2">
                    <p className="text-ds-10 text-muted-foreground mb-0.5">Special Requirements</p>
                    <p className="text-ds-11 text-foreground">{job.special_requirements}</p>
                  </div>
                )}
                {(job.description.length > 100 || job.special_requirements?.trim()) && (
                  <button
                    type="button"
                    className="text-ds-10 text-primary hover:underline inline-flex items-center gap-1"
                    onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : job.id); }}
                  >
                    {isExpanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> More details</>}
                  </button>
                )}
              </div>
            )}

              {/* Assigned helper display */}
              {job.helper_id && (job.status === "accepted" || job.status === "in_progress" || job.status === "revision_requested" || job.status === "completed" || job.status === "disputed") && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-ds-sm bg-muted/40">
                  <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-10 font-bold shrink-0">
                    {(helperNames[job.helper_id] || "H")[0].toUpperCase()}
                  </div>
                  <span className="text-ds-11 text-muted-foreground">Offered to</span>
                  <a href={`/user/${job.helper_id}`} onClick={(e) => e.stopPropagation()} className="text-ds-11 font-medium text-primary hover:underline">
                    {helperNames[job.helper_id] || "Helpr"}
                  </a>
                </div>
              )}

              {/* Cancelled: show fee info if a fee was recorded */}
              {job.status === "cancelled" && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 text-ds-11 font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: "hsl(var(--destructive) / 0.08)",
                        color: "hsl(var(--destructive))",
                        border: "0.5px solid hsl(var(--destructive) / 0.22)",
                      }}
                    >
                      <Ban className="w-3 h-3" /> Cancelled
                    </span>
                    {/* Fee status badge — only when a fee was actually assessed */}
                    {job.cancellation_fee != null && job.cancellation_fee > 0 && job.cancellation_fee_status && (() => {
                      const feeAmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(job.cancellation_fee);
                      const statusCopy: Record<string, string> = {
                        pending: `Fee ${feeAmt} · pending`,
                        charged: `Fee ${feeAmt} · charged`,
                        waived:  `Fee ${feeAmt} · waived`,
                      };
                      const label = statusCopy[job.cancellation_fee_status] ?? `Fee ${feeAmt}`;
                      const isPending = job.cancellation_fee_status === "pending";
                      const isCharged = job.cancellation_fee_status === "charged";
                      return (
                        <span
                          className="inline-flex items-center gap-1 text-ds-11 font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: isCharged
                              ? "hsl(var(--destructive) / 0.07)"
                              : isPending
                              ? "hsl(var(--gold-warm) / 0.12)"
                              : "hsl(var(--olivewood) / 0.08)",
                            color: isCharged
                              ? "hsl(var(--destructive))"
                              : isPending
                              ? "hsl(36 72% 28%)"
                              : "hsl(var(--olivewood))",
                            border: `0.5px solid ${isCharged ? "hsl(var(--destructive) / 0.20)" : isPending ? "hsl(var(--gold-warm) / 0.30)" : "hsl(var(--olivewood) / 0.22)"}`,
                          }}
                        >
                          <DollarSign className="w-3 h-3" /> {label}
                        </span>
                      );
                    })()}
                  </div>
                  {/* Re-post CTA — all cancelled / expired jobs.
                      Navigates to /post-job?rebook=<id> which pre-fills
                      every field except the date (date must be in the
                      future; old date is intentionally skipped). */}
                  <Button
                    size="sm"
                    variant="bark"
                    className="w-full rounded-ds-md mt-2"
                    onClick={(e) => { e.stopPropagation(); navigate(`/post-job?rebook=${job.id}`); }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Re-post this task
                  </Button>
                </div>
              )}

              {/* Accepted status */}
              {job.status === "accepted" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {job.helper_confirmed_at
                      ? <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} accepted</span>
                      : <span className="text-ds-11 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"} to accept</span>
                    }
                  </div>
                  {/* Job countdown */}
                  <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
                  {job.helper_confirmed_at && (
                    <div className="space-y-1.5">
                      {job.helper_arrived_at && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm bg-emerald-500/10 text-emerald-600">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                            <span className="ml-auto text-ds-10 text-muted-foreground">{new Date(job.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          {job.poster_confirmed_arrival_at ? (
                            <span className="text-ds-11 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> Arrival confirmed</span>
                          ) : (
                            <Button size="sm" className="w-full" onClick={() => onConfirmArrival(job.id)}>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}


              {(job.status === "in_progress" || job.status === "revision_requested") && job.poster_confirmed_arrival_at && !job.poster_confirmed_working_at && (
                <span className="text-ds-11 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> Arrival confirmed</span>
              )}

              {/* Completion confirmation */}
              {(job.status === "in_progress" || job.status === "revision_requested") && (job.poster_completed_at || job.helper_completed_at) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> You confirmed</span>}
                  {job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>}
                  {!job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for you</span>}
                  {!job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"}</span>}
                </div>
              )}

              {/* Visible live tracking */}
              {(job.status === "accepted" || job.status === "in_progress") && job.helper_id && (
                <div onClick={(e) => e.stopPropagation()}>
                  <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} />
                </div>
              )}

              {/* Pet care report card — show incoming daily reports from helper */}
              {job.category === "pet_care" && (job.status === "accepted" || job.status === "in_progress" || job.status === "completed") && (
                <div onClick={(e) => e.stopPropagation()}>
                  <IncomingReportCard jobId={job.id} />
                </div>
              )}

              {/* Revision notice */}
              {job.status === "revision_requested" && (
                <div className="p-2 rounded-ds-sm bg-yellow-500/10 border border-yellow-500/20 space-y-1.5">
                  <p className="text-ds-11 text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                  {job.revision_note && <p className="text-ds-11 text-muted-foreground">{job.revision_note}</p>}
                  {job.revision_completed_at && (
                    <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-ds-11 text-emerald-600 font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> Helpr marked revision as fixed</p>
                      {job.revision_acceptance_deadline && (
                        <DeadlineCountdown
                          deadline={job.revision_acceptance_deadline}
                          expiredText="Acceptance deadline passed — payment releasing to helpr"
                          consequenceText="Accept the fix, or dispute. If no action is taken, payment auto-releases to the helpr."
                          variant="warning"
                        />
                      )}
                    </div>
                  )}
                  {!job.revision_completed_at && job.revision_deadline && (
                    <DeadlineCountdown
                      deadline={job.revision_deadline}
                      expiredText="Revision deadline passed — you can now dispute or complete"
                      consequenceText="Helpr must fix the revision before this deadline. After that, you can dispute or mark complete."
                      variant="warning"
                    />
                  )}
                </div>
              )}
            </div>

            

            {/* Completed hint */}
            {job.status === "completed" && (() => {
              const cMeta = completedJobMeta[job.id];
              const hasTipped = cMeta?.tipped;
              const hasReviewed = cMeta?.reviewed;
              if (hasTipped && hasReviewed) {
                return (
                  <div className="px-4 py-1.5 border-t border-[hsl(var(--olivewood)/0.1)] bg-card flex items-center justify-between">
                    <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Tipped & Reviewed</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                );
              }
              return (!hasTipped || !hasReviewed) ? (
                <div className="px-4 py-1.5 border-t border-[hsl(var(--olivewood)/0.1)] bg-card">
                  <span className="text-ds-11 text-muted-foreground">
                    {!hasTipped && !hasReviewed ? "Tip & review" : !hasTipped ? "Leave a tip" : "Leave a review"}
                  </span>
                </div>
              ) : null;
            })()}

            {/* Re-post CTA — completed jobs that are fully archived (tipped & reviewed).
                The actions section (below) already shows "Hire again"/"Re-post" for
                jobs still awaiting tip/review, so this surfaces only when the card
                collapses into its archived state and that section is hidden. */}
            {job.status === "completed" && isFullyCompleted && !isExpanded && (
              <div className="px-4 pb-3 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full rounded-ds-md"
                  onClick={(e) => { e.stopPropagation(); navigate(job.helper_id ? `/post-job?rebook=${job.id}&offerTo=${job.helper_id}` : `/post-job?rebook=${job.id}`); }}
                >
                  <RotateCcw className="w-4 h-4 mr-1.5" /> Re-post
                </Button>
              </div>
            )}

            {/* Additional details - collapsible for fully completed jobs */}
            {(!isFullyCompleted || isExpanded) && (
            <div>
              <div className="px-4 py-3 space-y-3 border-t border-border/30">
                {(job.photos || []).length > 0 && (
                  <div>
                    <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                    <JobCardPhotoStrip urls={job.photos || []} size="md" />
                  </div>
                )}


              </div>

              {/* Features for active jobs */}
              {(job.status === "in_progress" || job.status === "accepted") && (
                <div className="px-4 pb-3 space-y-3">
                  <JobConfirmation jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
                  {job.is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner={true} initialHelpers={initialGroupHelpers} />}
                  
                </div>
              )}

              {/* Applicants button + inline expanded applicant list */}
              {job.status === "open" && (
                <div className="px-4 py-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" className="w-full rounded-ds-md glass-press" onClick={() => onLoadApplications(job)}>
                    <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
                  </Button>

                  {/* Inline applicants — load when the card is expanded.
                      Shows a skeleton while loading, an error+retry when
                      the fetch failed, and an empty-state with a share/boost
                      hint when there are zero applicants. */}
                  {isExpanded && (() => {
                    const isLoadingInline = loadingApplicants[job.id];
                    const hasError = applicantErrors[job.id];
                    const apps = inlineApplicants[job.id];

                    // Kick off the fetch the first time the card expands.
                    if (!isLoadingInline && !hasError && apps === undefined) {
                      onLoadInlineApplicants(job.id);
                    }

                    if (isLoadingInline) {
                      return (
                        <div className="space-y-2 py-1">
                          {[1, 2].map((i) => (
                            <Skeleton key={i} className="h-10 rounded-ds-sm" />
                          ))}
                        </div>
                      );
                    }

                    if (hasError) {
                      return (
                        <div
                          className="rounded-ds-md px-3 py-2.5 flex items-center gap-2"
                          style={{
                            background: "hsl(var(--destructive) / 0.06)",
                            border: "0.5px solid hsl(var(--destructive) / 0.22)",
                          }}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-destructive" />
                          <p className="font-serif italic flex-1" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.85)" }}>
                            Couldn't load applicants.
                          </p>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-ds-11 font-semibold text-primary hover:underline"
                            onClick={() => onLoadInlineApplicants(job.id)}
                          >
                            <RotateCw className="w-3 h-3" /> Retry
                          </button>
                        </div>
                      );
                    }

                    if (apps !== undefined && apps.length === 0) {
                      return (
                        <div
                          className="rounded-ds-md px-3 py-2.5 space-y-1.5"
                          style={{
                            background: "hsl(var(--olivewood) / 0.05)",
                            border: "0.5px solid hsl(var(--olivewood) / 0.16)",
                          }}
                        >
                          <p
                            className="font-display italic font-bold"
                            style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                          >
                            No applicants yet
                          </p>
                          <p
                            className="font-serif italic leading-snug"
                            style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.75)" }}
                          >
                            Share your task or Boost it (below) to reach more helprs nearby.
                          </p>
                        </div>
                      );
                    }

                    // Render the inline applicant list with TrustRow
                    // showing each applicant's completed jobs and rating.
                    if (apps !== undefined && apps.length > 0) {
                      const pendingCount = apps.filter((a) => a.status === "pending").length;
                      return (
                        <div className="space-y-2 py-1">
                          {apps.map((app) => {
                            const name = app.profiles?.full_name || "Helpr";
                            return (
                              <div
                                key={app.id}
                                className="flex items-center gap-2 px-2.5 py-2 rounded-ds-sm"
                                style={{
                                  background: "hsl(var(--olivewood) / 0.05)",
                                  border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                                }}
                              >
                                {/* Left: avatar + name + trust — tappable to
                                    open the helper's full profile page. The
                                    whole left column is the tap target; action
                                    buttons (Save, etc.) stay on the right so
                                    there's no accidental nav when tapping them. */}
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 flex items-center gap-2 text-left active:opacity-70 transition-opacity"
                                  onClick={() => navigate(`/user/${app.helper_id}`)}
                                  aria-label={`View ${name}'s profile`}
                                >
                                  {/* Avatar circle */}
                                  <div
                                    className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-ds-11 font-bold overflow-hidden"
                                    style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}
                                  >
                                    {app.profiles?.avatar_url ? (
                                      <img
                                        src={app.profiles.avatar_url}
                                        alt={name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      name[0].toUpperCase()
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <p
                                        className="font-display italic font-bold truncate"
                                        style={{ fontSize: "0.82rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                                      >
                                        {name}
                                      </p>
                                      {/* Subtle arrow signals the row is tappable */}
                                      <ChevronRight
                                        className="w-3 h-3 shrink-0"
                                        style={{ color: "hsl(var(--olivewood) / 0.80)" }}
                                        aria-hidden="true"
                                      />
                                      {(app as WithBidPrice).proposed_price != null && (
                                        <span
                                          className="text-ds-11 font-semibold px-2 py-0.5 rounded-full shrink-0"
                                          style={{
                                            background: "hsl(var(--sage) / 0.15)",
                                            color: "hsl(var(--sage))",
                                          }}
                                        >
                                          Bid: ${(app as WithBidPrice).proposed_price}
                                        </span>
                                      )}
                                    </div>
                                    <TrustRow
                                      completedJobs={
                                        typeof (app as { completedJobs?: number }).completedJobs === "number"
                                          ? (app as { completedJobs?: number }).completedJobs
                                          : undefined
                                      }
                                      avgRating={app.avgRating ?? undefined}
                                      reviewCount={app.reviewCount ?? undefined}
                                      className="mt-0.5"
                                    />
                                  </div>
                                </button>
                                {app.status === "pending" && userId && (
                                  <SaveHelperButton
                                    helperId={app.helper_id}
                                    customerId={userId}
                                    className="shrink-0 h-8 w-8"
                                  />
                                )}
                              </div>
                            );
                          })}

                          {/* "Message all" — only when 2+ pending applicants */}
                          {pendingCount >= 2 && (
                            <div className="pt-1">
                              {!broadcastOpen ? (
                                <button
                                  type="button"
                                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-ds-md text-ds-12 font-semibold transition-colors"
                                  style={{
                                    background: "hsl(210 55% 47% / 0.10)",
                                    color: "hsl(210 62% 30%)",
                                    border: "0.5px solid hsl(210 55% 47% / 0.28)",
                                  }}
                                  onClick={() => {
                                    setBroadcastOpen(true);
                                    // Focus the textarea on next tick after render.
                                    setTimeout(() => broadcastRef.current?.focus(), 50);
                                  }}
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  Message all {pendingCount} applicants
                                </button>
                              ) : (
                                /* Inline compose area */
                                <div
                                  className="rounded-ds-md p-3 space-y-2"
                                  style={{
                                    background: "hsl(210 55% 47% / 0.06)",
                                    border: "0.5px solid hsl(210 55% 47% / 0.24)",
                                  }}
                                >
                                  <div className="flex items-center justify-between mb-0.5">
                                    <p
                                      className="text-ds-11 font-semibold"
                                      style={{ color: "hsl(210 62% 30%)" }}
                                    >
                                      Message all {pendingCount} applicants
                                    </p>
                                    <button
                                      type="button"
                                      aria-label="Close"
                                      className="p-1 rounded-full hover:bg-muted/60 transition-colors"
                                      onClick={() => {
                                        setBroadcastOpen(false);
                                        setBroadcastText("");
                                      }}
                                    >
                                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                  </div>
                                  <textarea
                                    ref={broadcastRef}
                                    className="w-full resize-none rounded-ds-sm px-3 py-2 text-ds-12 text-foreground placeholder:text-muted-foreground/60 bg-background border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                    rows={3}
                                    placeholder={`e.g. "I'm running 15 min late — please bring your own gloves"`}
                                    value={broadcastText}
                                    onChange={(e) => setBroadcastText(e.target.value)}
                                    maxLength={500}
                                    disabled={broadcastSending}
                                  />
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-ds-10 text-muted-foreground">
                                      {broadcastText.length}/500
                                    </span>
                                    <Button
                                      size="sm"
                                      disabled={!broadcastText.trim() || broadcastSending}
                                      onClick={handleBroadcastMessage}
                                      className="h-8 px-3 rounded-ds-md text-ds-12"
                                    >
                                      <Send className="w-3.5 h-3.5 mr-1" />
                                      {broadcastSending ? "Sending…" : `Send to all`}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return null;
                  })()}
                </div>
              )}

              {/* Analytics mini-panel — only shown when there's data to display */}
              {jobAnalytics && (jobAnalytics.viewCount > 0 || jobAnalytics.applicantCount > 0) && (
                <div
                  className="mx-4 rounded-ds-md px-3 py-2.5 space-y-1.5 mb-2"
                  style={{ background: "hsl(var(--parchment) / 0.4)", border: "1px solid hsl(var(--olivewood) / 0.1)" }}
                >
                  <p className="text-ds-11 font-semibold uppercase tracking-[0.1em]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Activity
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {jobAnalytics.viewCount > 0 && (
                      <span className="text-ds-12 flex items-center gap-1" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
                        <Eye className="w-3 h-3" /> {jobAnalytics.viewCount} {jobAnalytics.viewCount === 1 ? "view" : "views"}
                      </span>
                    )}
                    {jobAnalytics.applicantCount > 0 && (
                      <span className="text-ds-12 flex items-center gap-1" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
                        <Users className="w-3 h-3" /> {jobAnalytics.applicantCount} applied
                      </span>
                    )}
                    {jobAnalytics.conversionRate !== null && (
                      <span className="text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.55)" }}>
                        {jobAnalytics.conversionRate}% applied
                      </span>
                    )}
                  </div>
                  {/* Bid range — only for accept_bids jobs */}
                  {jobAnalytics.bidAvg !== null && (
                    <p className="text-ds-11" style={{ color: "hsl(var(--ink-deep) / 0.55)" }}>
                      Bids: ${jobAnalytics.bidMin?.toFixed(0)}–${jobAnalytics.bidMax?.toFixed(0)} · avg ${jobAnalytics.bidAvg.toFixed(0)}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="border-t border-[hsl(var(--olivewood)/0.1)] bg-card px-4 py-3">
                <div className="space-y-2">
                  {job.status === "open" && (() => {
                    // Boost cooldown — show when the job is currently
                    // boosted so the poster knows the boost is running
                    // and when they can re-boost (after expiry).
                    const boostExp = job.boost_expires_at
                      ? new Date(job.boost_expires_at)
                      : null;
                    const isBoosted = boostExp && boostExp > new Date();
                    // Stale-job nudge — a two-sided liquidity prompt for
                    // the poster's side: an open job with zero applicants
                    // that's been up more than 24h is quietly stuck.
                    // Surface a gentle pointer to Boost (the existing
                    // paid visibility lever) so they have a clear next
                    // move. Hidden once it's already boosted — Boost is
                    // doing its job — or once applicants arrive.
                    const ageHours = differenceInHours(new Date(), new Date(job.created_at));
                    const isStale =
                      !isBoosted &&
                      ageHours >= 24 &&
                      (applicantCounts[job.id] || 0) === 0;
                    return (
                    <>
                      {isBoosted && (
                        <div
                          className="rounded-ds-md px-3 py-2 mb-2 flex items-center gap-2"
                          style={{
                            background: "hsl(var(--gold-warm) / 0.10)",
                            border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
                          }}
                        >
                          <Rocket className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.25} />
                          <p
                            className="font-serif italic leading-snug"
                            style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.85)" }}
                          >
                            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                              Boosted until {boostExp.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.
                            </span>{" "}
                            Re-boost available after expiry.
                          </p>
                        </div>
                      )}
                      {/* Color-coded actions — each lever gets its own muted
                          hue so the row reads at a glance without shouting:
                          Boost = orange (visibility), Edit = gold/yellow,
                          Share = blue, Cancel = red. Applicants (above) stays
                          the single solid-green primary. Tints are kept low so
                          it's colorful, not loud. */}
                      <div className="space-y-2">
                        <Button
                          variant="outline" size="sm"
                          className="w-full rounded-ds-md glass-press border-0"
                          style={{ background: "hsl(25 75% 48% / 0.14)", color: "hsl(25 82% 28%)", border: "0.5px solid hsl(25 75% 48% / 0.34)" }}
                          disabled={!!isBoosted}
                          onClick={() => onBoost(job.id)}
                        >
                          <Rocket className="w-4 h-4 mr-1" /> {isBoosted ? "Boosted" : "Boost"}
                        </Button>
                        {/* Broadcast-boost button — only shown when the job
                            is stale (24h+ open, 0 applicants). Sends a targeted
                            push notification to nearby approved helpers. One
                            send per session (button disables after tap). */}
                        {isStale && !broadcastBoosted && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full rounded-ds-md glass-press border-0 btn-press"
                            style={{
                              background: "hsl(var(--gold-warm) / 0.12)",
                              color: "hsl(36 80% 28%)",
                              border: "0.5px solid hsl(var(--gold-warm) / 0.38)",
                            }}
                            disabled={broadcastBoosting}
                            onClick={handleBroadcastBoost}
                          >
                            <Zap className="w-3.5 h-3.5 mr-1" />
                            {broadcastBoosting ? "Notifying helprs…" : "Notify nearby helprs"}
                          </Button>
                        )}
                        {isStale && broadcastBoosted && (
                          <div
                            className="rounded-ds-md px-3 py-2 flex items-center gap-2"
                            style={{
                              background: "hsl(var(--gold-warm) / 0.10)",
                              border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
                            }}
                          >
                            <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--gold-warm))" }} />
                            <p
                              className="font-serif italic leading-snug"
                              style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.85)" }}
                            >
                              <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                                Helprs notified!
                              </span>{" "}
                              Nearby helprs received a push notification.
                            </p>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          <Button
                            variant="outline" size="sm"
                            className="w-full glass-press border-0"
                            style={{ background: "hsl(var(--gold-warm) / 0.16)", color: "hsl(36 72% 25%)", border: "0.5px solid hsl(var(--gold-warm) / 0.36)" }}
                            onClick={() => onEdit(job)}
                          >
                            <Pencil className="w-4 h-4 mr-1" /> Edit
                          </Button>
                          <ShareJobButton
                            job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                            className="w-full glass-press border-0"
                            style={{ background: "hsl(210 55% 47% / 0.12)", color: "hsl(210 62% 30%)", border: "0.5px solid hsl(210 55% 47% / 0.32)" }}
                          />
                          <Button
                            variant="outline" size="sm"
                            className="w-full glass-press border-0"
                            style={{ background: "hsl(6 58% 46% / 0.11)", color: "hsl(6 62% 34%)", border: "0.5px solid hsl(6 58% 46% / 0.32)" }}
                            onClick={() => onCancel(job)}
                          >
                            <XCircle className="w-4 h-4 mr-1" /> Cancel
                          </Button>
                        </div>
                      </div>
                    </>
                    );
                  })()}
                  {job.status === "accepted" && (
                    <div className="space-y-2">
                      <p className="text-ds-11 text-muted-foreground text-center">
                        <Clock className="w-3 h-3 inline mr-1" />
                        Helpr must confirm 24 hours before the job starts — tracking actions unlock then
                      </p>
                      {startRequestedJobIds.has(job.id) && !job.helper_confirmed_at && (
                        <Button size="sm" className="w-full" onClick={() => onConfirmStart(job.id)}><CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Start</Button>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" className="flex-1" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                      </div>
                      {/* Share link — lets the poster spread the word even
                          after a helper has been accepted. Opens the OS
                          Share Sheet on native; copies the URL on web. */}
                      <ShareJobButton
                        job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                        className="w-full glass-press border-0"
                        style={{ background: "hsl(210 55% 47% / 0.10)", color: "hsl(210 62% 30%)", border: "0.5px solid hsl(210 55% 47% / 0.28)" }}
                      />
                    </div>
                  )}
                  {(job.status === "in_progress" || job.status === "revision_requested") && (
                    <div className="space-y-2">
                      {/* Confirm Arrival notice */}
                      {job.helper_arrived_at && !job.poster_confirmed_arrival_at && (
                        <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm bg-emerald-500/10 text-emerald-600">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                          <span className="ml-auto text-ds-10 text-muted-foreground">{new Date(job.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                      {/* Confirm Arrival + No-Show side by side */}
                      {job.status === "in_progress" && (
                        <div className="flex items-center gap-2">
                          {!job.poster_completed_at && !job.helper_arrived_at && (() => {
                            const now = new Date();
                            // 1hr after start time OR 1hr after on_the_way
                            let canNoShow = false;
                            if (job.helper_on_the_way_at) {
                              canNoShow = now.getTime() - new Date(job.helper_on_the_way_at).getTime() >= 60 * 60 * 1000;
                            }
                            if (job.start_time && job.date_needed) {
                              const base = parseLocalDate(job.date_needed);
                              const [h, m] = job.start_time.split(":").map(Number);
                              base.setHours(h, m, 0, 0);
                              const startPlus1h = new Date(base.getTime() + 60 * 60 * 1000);
                              if (now >= startPlus1h) canNoShow = true;
                            }
                            if (!canNoShow) return null;
                            return (
                              <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onNoShow(job.id)}>
                                <XCircle className="w-4 h-4 mr-1" /> No-Show
                              </Button>
                            );
                          })()}
                          {job.helper_arrived_at && !job.poster_confirmed_arrival_at && (
                            <Button size="sm" className="flex-1" onClick={() => onConfirmArrival(job.id)}>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                            </Button>
                          )}
                        </div>
                      )}
                      {/* Confirm Working */}
                      {job.status === "in_progress" && !job.poster_confirmed_working_at && job.poster_confirmed_arrival_at && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm bg-amber-500/10 text-amber-600">
                            <Wrench className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">Is the helpr working?</span>
                          </div>
                          <Button size="sm" className="w-full" onClick={() => onConfirmWorking(job.id)}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Working
                          </Button>
                        </div>
                      )}
                      {/* 72h countdown after helper marks complete */}
                      {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && (
                        <DeadlineCountdown
                          deadline={new Date(new Date(job.helper_completed_at).getTime() + 72 * 60 * 60 * 1000).toISOString()}
                          expiredText="72 hours passed — payment auto-released to helpr"
                          consequenceText="Approve & complete or request a revision before the timer expires, or payment will auto-release to the helpr."
                          variant="warning"
                        />
                      )}
                      {/* Approve & Complete (primary) — only after helper marks done.
                          Opens the two-path CompletionChoiceSheet so the poster
                          can either confirm ("looks great") or request a revision
                          before escrow releases. */}
                      {job.helper_completed_at && (
                        <>
                          <Button
                            size="sm"
                            className="w-full rounded-ds-md"
                            onClick={() => {
                              if (!job.poster_completed_at) {
                                setCompletionSheetOpen(true);
                              }
                            }}
                            disabled={completingJobId === job.id || !!job.poster_completed_at}
                            style={
                              !job.poster_completed_at
                                ? {
                                    background: "hsl(var(--bark))",
                                    backgroundImage: "none",
                                    border: "1px solid hsl(var(--bark))",
                                    color: "hsl(var(--parchment))",
                                    fontFamily: "Montserrat, system-ui, sans-serif",
                                    fontWeight: 600,
                                    letterSpacing: "0.01em",
                                    boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
                                  }
                                : undefined
                            }
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            {completingJobId === job.id ? "…" : job.poster_completed_at ? "Approved" : "Approve & release payment"}
                          </Button>
                          <CompletionChoiceSheet
                            open={completionSheetOpen}
                            jobId={job.id}
                            jobTitle={job.title}
                            helperId={job.helper_id}
                            helperName={job.helper_id ? (helperNames[job.helper_id] || "Helpr") : "Helpr"}
                            userId={userId}
                            onClose={() => setCompletionSheetOpen(false)}
                            onConfirm={() => onComplete(job.id)}
                            onRevisionSubmitted={onActionComplete}
                          />
                        </>
                      )}
                      {/* Message — primary action while work is in progress */}
                      <Button
                        size="sm"
                        variant={job.helper_completed_at ? "outline" : "default"}
                        className="w-full"
                        onClick={() => navigate("/messages")}
                      >
                        <MessageSquare className="w-4 h-4 mr-1" /> Message Helper
                      </Button>
                      {/* Share link — available while work is in progress so
                          the poster can still spread the word or share proof
                          of work with others. Opens the OS Share Sheet on
                          native; copies the URL on web. */}
                      <ShareJobButton
                        job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                        className="w-full glass-press border-0"
                        style={{ background: "hsl(210 55% 47% / 0.10)", color: "hsl(210 62% 30%)", border: "0.5px solid hsl(210 55% 47% / 0.28)" }}
                      />
                      {/* Request Revision — only after helper marks complete (Stage 2) */}
                      {job.status === "in_progress" && !job.poster_completed_at && job.helper_completed_at && (
                        <Button size="sm" variant="ghost" className="w-full text-muted-foreground hover:text-destructive text-ds-11" onClick={() => onRevision(job.id)}>
                          <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Request a revision instead
                        </Button>
                      )}
                      {/* Dispute — Stage 3, only after revision deadline has passed without resolution */}
                      {job.status === "revision_requested" && job.revision_deadline && new Date(job.revision_deadline) < new Date() && !job.revision_completed_at && (
                        <button
                          onClick={() => onDispute(job)}
                          className="w-full text-ds-11 text-muted-foreground hover:text-destructive underline underline-offset-2 py-1 transition-colors"
                        >
                          Still unresolved? File a formal dispute
                        </button>
                      )}
                      {/* Issue #113 — always-findable dispute path during a
                          pending revision. Distinct from the deadline-gated
                          button above: this surfaces *whenever* a revision is
                          open, not only after the deadline elapses. The
                          component self-hides for jobs already in dispute. */}
                      <DisputeLink
                        job={job}
                        side="customer"
                        onOpenDispute={() => onDispute(job)}
                      />
                    </div>
                  )}
                  {job.status === "completed" && (() => {
                    const meta = completedJobMeta[job.id];
                    const hasTipped = meta?.tipped;
                    const hasReviewed = meta?.reviewed;
                    const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";
                    return (
                      <div className="space-y-2">
                        <PhotoProofGroup
                          jobId={job.id}
                          beforeUrls={job.proof_before_urls || []}
                          afterUrls={job.proof_after_urls || []}
                          canUpload={false}
                        />
                        {!hasTipped ? (
                          <Button size="sm" className="w-full bg-accent/15 text-accent hover:bg-accent/25 border-0" onClick={() => onTip(job.id, helperName)}>
                            <DollarSign className="w-4 h-4 mr-1" /> Tip {helperName}
                          </Button>
                        ) : (
                          <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Tipped
                          </Button>
                        )}
                        {job.payment_status === "released" && (
                          !hasReviewed ? (
                            <Button size="sm" className="w-full bg-accent/15 text-accent hover:bg-accent/25 border-0" onClick={() => onReview(job)}>
                              <Star className="w-4 h-4 mr-1" /> Review
                            </Button>
                          ) : (
                            <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Reviewed
                            </Button>
                          )
                        )}
                        {/* Hire again — direct offer to the same helper.
                            Routes to PostJob with offerTo + rebook query so
                            the form is prefilled AND the offer goes straight
                            to them (skipping the open-application queue). */}
                        {job.helper_id ? (
                          <Button
                            variant="bark"
                            size="sm"
                            className="w-full rounded-ds-md"
                            onClick={() => navigate(`/post-job?rebook=${job.id}&offerTo=${job.helper_id}`)}
                          >
                            <RotateCcw className="w-4 h-4 mr-1" /> Hire {helperName} again
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full liquid-glass glass-press" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Re-post this task
                          </Button>
                        )}
                        {!job.poster_completed_at && (
                          <>
                            {job.revision_requested_at ? (
                              <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onDispute(job)}>
                                <AlertTriangle className="w-4 h-4 mr-1" /> Dispute
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onRevision(job.id)}>
                                  <AlertTriangle className="w-4 h-4 mr-1" /> Request Revision
                                </Button>
                                <p className="text-ds-10 text-muted-foreground text-center italic">Request a revision first before filing a dispute</p>
                              </>
                            )}
                          </>
                        )}
                        {/* Issue #113 — quiet, always-findable dispute path for
                            the 7-day window after completion. The component
                            self-hides outside that window or once a dispute is
                            already filed, so this lives unconditionally here. */}
                        <DisputeLink
                          job={job}
                          side="customer"
                          onOpenDispute={() => onDispute(job)}
                        />
                      </div>
                    );
                  })()}
                  {job.status === "disputed" && (() => {
                    const disputeStatus = job.dispute_status || "open";
                    const isDisputer = job.disputed_by === userId;
                    return (
                    <div className="space-y-2">
                      {job.poster_confirmed_working_at && (
                        <PhotoProofGroup
                          jobId={job.id}
                          beforeUrls={job.proof_before_urls || []}
                          afterUrls={job.proof_after_urls || []}
                          canUploadBefore={false}
                          canUploadAfter={false}
                          requireAfter={true}
                          budget={job.budget}
                        />
                      )}
                      <div className="p-3 rounded-ds-sm bg-destructive/5 border border-destructive/20">
                        <p className="text-ds-11 text-destructive font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 
                          {disputeStatus === "escalated" ? "Escalated to Admin" : disputeStatus === "resolved" ? "Dispute Resolved" : "Dispute Under Review"}
                        </p>
                        <p className="text-ds-11 text-muted-foreground mt-1">Payment is on hold pending resolution.</p>
                        {job.dispute_reason && <p className="text-ds-11 text-muted-foreground mt-1 italic">"{job.dispute_reason}"</p>}
                        {job.dispute_helper_response && (
                          <div className="mt-2 p-2 rounded bg-muted/50">
                            <p className="text-ds-10 text-muted-foreground font-medium">Helpr's response:</p>
                            <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
                          </div>
                        )}
                        {job.dispute_deadline && disputeStatus !== "resolved" && (
                          <DeadlineCountdown
                            deadline={job.dispute_deadline}
                            expiredText="Deadline passed — payment auto-releasing to helpr"
                            consequenceText="Confirm the issue is fixed or escalate to admin. If no action is taken, payment auto-releases to the helpr."
                            variant="destructive"
                          />
                        )}
                      </div>
                      <div className="p-2 rounded-ds-sm bg-card">
                        <p className="text-ds-10 text-muted-foreground leading-relaxed">
                          <strong>Policy:</strong> You have 72 hours to confirm the issue is fixed or escalate to admin. If you do nothing, payment auto-releases to the helpr.
                        </p>
                      </div>
                      {/* Disputer actions: Mark Resolved or Escalate */}
                      {isDisputer && disputeStatus === "open" && (
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" disabled={disputeActing} className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" onClick={async (e) => {
                            e.stopPropagation();
                            setDisputeActing(true);
                            try {
                              const { error } = await supabase.from("jobs").update({ status: "completed", dispute_status: "resolved", dispute_resolved_at: new Date().toISOString() }).eq("id", job.id);
                              if (error) { hapticError(); toast.error("We couldn't mark that resolved — please try again."); return; }
                              if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, type: "payment", link: "/my-jobs?filter=completed" });
                              hapticSuccess();
                              toast.success("Dispute resolved — payment released to helpr");
                              onActionComplete();
                            } finally {
                              setDisputeActing(false);
                            }
                          }}><CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved</Button>
                          <Button size="sm" variant="outline" disabled={disputeActing} className="w-full text-destructive border-destructive/30 hover:bg-destructive/5 disabled:opacity-60" onClick={async (e) => {
                            e.stopPropagation();
                            setDisputeActing(true);
                            try {
                              const { error } = await supabase.from("jobs").update({ dispute_status: "escalated" }).eq("id", job.id);
                              if (error) { hapticError(); toast.error("We couldn't escalate that — please try again."); return; }
                              const { data: adminRoles, error: adminErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                              if (adminErr) report(adminErr, { tags: { source: "PostedJobCard.escalateNotifyAdmins" } });
                              if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin" }); } }
                              hapticSuccess();
                              toast.success("Dispute escalated to admin for final decision");
                              onActionComplete();
                            } finally {
                              setDisputeActing(false);
                            }
                          }}><AlertTriangle className="w-4 h-4 mr-1" /> Escalate to Admin</Button>
                        </div>
                      )}
                      {isDisputer && disputeStatus === "escalated" && (
                        <div className="text-ds-11 text-center text-muted-foreground px-2 py-1.5 rounded bg-muted/50">Admin is reviewing this dispute. You'll be notified of the outcome.</div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={(e) => { e.stopPropagation(); onViewDispute(job); }}
                      >
                        <AlertTriangle className="w-4 h-4 mr-1" /> View timeline & add evidence
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message Helpr</Button>
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            )}
          </JobCardShell>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const PostedJobCard = memo(PostedJobCardInner);
