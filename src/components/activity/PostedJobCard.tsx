import { memo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import {
  MapPin, DollarSign, XCircle, CheckCircle2, RotateCcw, Star, MessageSquare,
  Users, Pencil, AlertTriangle, RefreshCw, Rocket, Clock, Calendar, Timer, Wrench,
  Share2, RotateCw,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { getCityState } from "@/lib/locationUtils";
import { parseLocalDate } from "@/lib/dateUtils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { type Job, type EnrichedApplication } from "./activityConstants";
import {
  EscrowProgressBar,
  deriveEscrowStepFromJob,
} from "@/components/payment/EscrowProgressBar";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { DisputeLink } from "@/components/jobs/DisputeLink";

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
  onBoostJob: (jobId: string) => void;
  /** Pre-fetched latest tracking row for this job, threaded down to
      <JobTracking> so the card doesn't fire its own SELECT on mount.
      `null` = pre-fetched and no row exists yet; `undefined` = not
      pre-fetched (the child falls back to its own per-mount query). */
  initialTracking?: TrackingData | null;
  /** Pre-fetched group-helper rows for this job (only relevant for active
      group jobs), threaded into <GroupJobHelpers> to skip its own 2-query
      waterfall on mount. */
  initialGroupHelpers?: GroupHelperLite[];
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
  onConfirmStart,
  onConfirmArrival,
  onConfirmWorking,
  onLoadApplications,
  onLoadInlineApplicants,
  inlineApplicants,
  loadingApplicants,
  applicantErrors,
  onBoostJob,
  initialTracking,
  initialGroupHelpers,
}: PostedJobCardProps) {
  const navigate = useNavigate();
  const meta = completedJobMeta[job.id];
  const isFullyCompleted = job.status === "completed" && meta?.tipped && meta?.reviewed;
  const isExpanded = expandedJobId === job.id;
  // Escrow progress lives above the action area — context, not a CTA.
  // Returns null for pre-paid / cancelled jobs so the bar hides cleanly
  // when escrow doesn't apply.
  const escrowStep = deriveEscrowStepFromJob(job);
  return (
          <div
            key={job.id}
            className={`group rounded-2xl liquid-glass overflow-hidden relative hover:shadow-md transition-all duration-200 ${isFullyCompleted ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : ""}`}
            onClick={isFullyCompleted ? () => setExpandedJobId(isExpanded ? null : job.id) : undefined}
            {...(isFullyCompleted && {
              role: "button",
              tabIndex: 0,
              "aria-expanded": isExpanded,
              onKeyDown: (e: ReactKeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedJobId(isExpanded ? null : job.id);
                }
              },
            })}
          >
            {/* Top bar — brand-aligned title + payout chip. Uses
                font-display italic to match the rest of the app's job
                surfaces (detail dialog, card, profile). */}
            <div
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
              style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
            >
              <h3
                className="font-display italic font-bold leading-snug truncate min-w-0 text-headline-card"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {job.title}
              </h3>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span
                  className="inline-flex items-center gap-0.5 font-display italic font-bold tabular-nums text-ds-13 px-2 py-0.5 rounded-full"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.10)",
                    color: "hsl(var(--burnt-sienna))",
                    letterSpacing: "-0.015em",
                  }}
                >
                  <DollarSign className="w-3.5 h-3.5" strokeWidth={2.25} />
                  {job.budget}
                </span>
              </div>
            </div>

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
              <div className="flex items-center gap-2.5 flex-wrap text-ds-11 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {!job.start_time ? " · Flexible time" : ` · ${new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                </span>
                {(() => {
                  const cityState = getCityState(job.location);
                  return (
                    <a onClick={(e) => e.stopPropagation()} href={job.latitude && job.longitude ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                      <MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[140px]">{cityState}</span>
                    </a>
                  );
                })()}
                {job.estimated_hours && (
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" /> {job.estimated_hours}h</span>
                )}
                {job.expires_at && !job.helper_id && (() => {
                  const expiryText = new Date(job.expires_at) <= new Date() ? "Expired" : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left";
                  const isExpiringSoon = differenceInHours(new Date(job.expires_at), new Date()) < 24;
                  return (<span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}><Timer className="w-3 h-3 shrink-0" /> {expiryText}</span>);
                })()}
                {(applicantCounts[job.id] || 0) > 0 && job.status === "open" && (
                  <span className="flex items-center gap-1 text-primary font-medium"><Users className="w-3 h-3 shrink-0" /> {applicantCounts[job.id]} applicant{applicantCounts[job.id] !== 1 ? "s" : ""}</span>
                 )}
                 {job.is_recurring && (
                   <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 shrink-0 text-primary" /> {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}</span>
                 )}
                 {job.is_group_job && (
                   <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} helprs` : "Group task"}</span>
                 )}
               </div>
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
                    className="text-ds-10 text-primary hover:underline"
                    onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : job.id); }}
                  >
                    {isExpanded ? "▲ Less" : "▼ More details"}
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

              {/* Accepted status */}
              {job.status === "accepted" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {job.helper_confirmed_at
                      ? <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} accepted</span>
                      : <span className="text-ds-11 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">⏳ Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"} to accept</span>
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
                            <span className="text-ds-11 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrival confirmed</span>
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
                <span className="text-ds-11 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrival confirmed</span>
              )}

              {/* Completion confirmation */}
              {(job.status === "in_progress" || job.status === "revision_requested") && (job.poster_completed_at || job.helper_completed_at) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ You confirmed</span>}
                  {job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>}
                  {!job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for you</span>}
                  {!job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"}</span>}
                </div>
              )}

              {/* Visible live tracking */}
              {(job.status === "accepted" || job.status === "in_progress") && job.helper_id && (
                <div onClick={(e) => e.stopPropagation()}>
                  <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} />
                </div>
              )}

              {/* Revision notice */}
              {job.status === "revision_requested" && (
                <div className="p-2 rounded-ds-sm bg-yellow-500/10 border border-yellow-500/20 space-y-1.5">
                  <p className="text-ds-11 text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                  {job.revision_note && <p className="text-ds-11 text-muted-foreground">{job.revision_note}</p>}
                  {job.revision_completed_at && (
                    <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-ds-11 text-emerald-600 font-medium">✓ Helpr marked revision as fixed</p>
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
                  <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15 flex items-center justify-between">
                    <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Tipped & Reviewed</span>
                    <span className="text-ds-11 text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                );
              }
              return (!hasTipped || !hasReviewed) ? (
                <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15">
                  <span className="text-ds-11 text-muted-foreground">
                    {!hasTipped && !hasReviewed ? "Tip & review" : !hasTipped ? "Leave a tip" : "Leave a review"}
                  </span>
                </div>
              ) : null;
            })()}

            {/* Additional details - collapsible for fully completed jobs */}
            {(!isFullyCompleted || isExpanded) && (
            <div>
              <div className="px-4 py-3 space-y-3 border-t border-border/30">
                {(job.photos || []).length > 0 && (
                  <div>
                    <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {(job.photos || []).map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                          {/* Thumbnail strip — fixed 112x80 (w-28 h-20) box,
                              already CLS-safe. Request a matching thumbnail. */}
                          <OptimizedImage src={url} width={112} height={80} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                        </a>
                      ))}
                    </div>
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
                  <Button size="sm" variant="outline" className="w-full border border-primary text-primary hover:bg-primary/10" onClick={() => onLoadApplications(job)}>
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
                            <div key={i} className="h-10 rounded-ds-sm bg-muted/40 animate-pulse" />
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
                            Share your task or Boost it to reach more helprs nearby.
                          </p>
                          <div className="flex gap-2 pt-0.5">
                            <Button
                              size="sm"
                              className="flex-1 bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0 text-ds-11"
                              onClick={() => onBoostJob(job.id)}
                            >
                              <Rocket className="w-3.5 h-3.5 mr-1" /> Boost
                            </Button>
                            {navigator.share && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-ds-11"
                                onClick={() => {
                                  navigator.share({ title: job.title, text: `Help needed: ${job.title}`, url: window.location.origin + `/dashboard?job=${job.id}` }).catch(() => {});
                                }}
                              >
                                <Share2 className="w-3.5 h-3.5 mr-1" /> Share
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })()}
                </div>
              )}

              {/* Actions */}
              <div className="border-t border-border/30 bg-muted/8 px-4 py-3">
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
                      {isStale && (
                        <div
                          className="rounded-ds-md px-3 py-2 mb-2 flex items-start gap-2"
                          style={{
                            background: "hsl(var(--accent) / 0.08)",
                            border: "0.5px solid hsl(var(--accent) / 0.30)",
                          }}
                        >
                          <Rocket className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent" strokeWidth={2.25} />
                          <p
                            className="font-serif italic leading-snug"
                            style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.85)" }}
                          >
                            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                              Quiet so far — no applicants yet.
                            </span>{" "}
                            A Boost lifts this task to the top of the feed
                            so more helprs see it.
                          </p>
                        </div>
                      )}
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
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="flex-1 bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" disabled={!!isBoosted} onClick={() => onBoost(job.id)}>
                          <Rocket className="w-4 h-4 mr-1" /> {isBoosted ? "Boosted" : "Boost"}
                        </Button>
                        <Button size="sm" className="flex-1 bg-primary/10 text-primary hover:bg-primary/20 border-0" onClick={() => onEdit(job)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                        <ShareJobButton
                          job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                          className="flex-1"
                        />
                        <Button size="sm" className="flex-1 bg-destructive/10 text-destructive hover:bg-destructive/20 border-0" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
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
                      {/* Approve & Complete (primary) — only after helper marks done */}
                      {job.helper_completed_at && (
                        <Button
                          size="sm"
                          className="w-full rounded-ds-md"
                          onClick={() => onComplete(job.id)}
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
                          {completingJobId === job.id ? "…" : job.poster_completed_at ? "Approved ✓" : "Approve & release payment"}
                        </Button>
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
                          <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onTip(job.id, helperName)}>
                            <DollarSign className="w-4 h-4 mr-1" /> Tip {helperName}
                          </Button>
                        ) : (
                          <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Tipped ✓
                          </Button>
                        )}
                        {job.payment_status === "released" && (
                          !hasReviewed ? (
                            <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onReview(job)}>
                              <Star className="w-4 h-4 mr-1" /> Review
                            </Button>
                          ) : (
                            <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Reviewed ✓
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
                          <Button size="sm" className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 border-0" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Rebook this task
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
                      <div className="p-2 rounded-ds-sm bg-muted/50 border border-border">
                        <p className="text-ds-10 text-muted-foreground leading-relaxed">
                          <strong>Policy:</strong> You have 72 hours to confirm the issue is fixed or escalate to admin. If you do nothing, payment auto-releases to the helpr.
                        </p>
                      </div>
                      {/* Disputer actions: Mark Resolved or Escalate */}
                      {isDisputer && disputeStatus === "open" && (
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={async (e) => {
                            e.stopPropagation();
                            const { error } = await supabase.from("jobs").update({ status: "completed", dispute_status: "resolved", dispute_resolved_at: new Date().toISOString() }).eq("id", job.id);
                            if (error) { toast.error("Failed to resolve"); return; }
                            if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, type: "payment", link: "/my-jobs?filter=completed" });
                            toast.success("Dispute resolved — payment released to helpr");
                            window.location.reload();
                          }}><CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved</Button>
                          <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={async (e) => {
                            e.stopPropagation();
                            const { error } = await supabase.from("jobs").update({ dispute_status: "escalated" }).eq("id", job.id);
                            if (error) { toast.error("Failed to escalate"); return; }
                            const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                            if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin" }); } }
                            toast.success("Dispute escalated to admin for final decision");
                            window.location.reload();
                          }}><AlertTriangle className="w-4 h-4 mr-1" /> Escalate to Admin</Button>
                        </div>
                      )}
                      {isDisputer && disputeStatus === "escalated" && (
                        <div className="text-ds-11 text-center text-muted-foreground px-2 py-1.5 rounded bg-muted/50">Admin is reviewing this dispute. You'll be notified of the outcome.</div>
                      )}
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
          </div>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const PostedJobCard = memo(PostedJobCardInner);
