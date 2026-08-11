import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  MapPin, DollarSign, CheckCircle2, RotateCcw,
  Users, AlertTriangle, RefreshCw, Clock,
  Check, ChevronDown, ChevronUp, Ban, Eye,
} from "lucide-react";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { ActivityStatePill } from "./ActivityStatePill";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { IncomingReportCard } from "./PetReportCard";
import { formatPrice, formatPriceExact } from "@/lib/format";
import { type PostedJobCardProps } from "./postedJobCard/types";
import { PostedJobApplicants } from "./postedJobCard/PostedJobApplicants";
import { PostedJobActions } from "./postedJobCard/PostedJobActions";

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
  confirmingStartJobId,
  onConfirmArrival,
  confirmingArrivalJobId,
  onConfirmWorking,
  confirmingWorkingJobId,
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

  const meta = completedJobMeta[job.id];
  const isFullyCompleted = job.status === "completed" && meta?.tipped && meta?.reviewed;
  const isExpanded = expandedJobId === job.id;
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
            <JobCardTitleBar title={job.title} amount={formatPrice(job.budget)} />

            {/* Summary */}
            <div className="px-4 py-3 space-y-2.5">
              {/* Where this job stands. Active folds several statuses into one
                  list, so without this a job awaiting a reply, one whose offer
                  was just declined, and one already underway all look alike.
                  Renders nothing outside the Active bucket — completed and
                  cancelled cards already carry their own treatment below. */}
              <ActivityStatePill
                posted={{
                  status: job.status,
                  helper_id: job.helper_id,
                  helper_confirmed_at: job.helper_confirmed_at,
                  offered_to_helper_id: job.offered_to_helper_id,
                  direct_offer_status: job.direct_offer_status,
                  applicantCount: applicantCounts[job.id] || 0,
                }}
              />
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
                   <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} Helpr${job.helpers_needed === 1 ? "" : "s"}` : "Group job"}</span>
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
                    aria-expanded={isExpanded}
                    className="inline-flex items-center gap-0.5 text-ds-11 font-medium text-primary hover:underline active:opacity-70"
                    onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : job.id); }}
                  >
                    {isExpanded
                      ? <>Hide details <ChevronUp className="w-3 h-3" /></>
                      : <>View details <ChevronDown className="w-3 h-3" /></>}
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
                  <span className="text-ds-11 text-muted-foreground">
                    {job.status === "completed" ? "Completed by" : "Offered to"}
                  </span>
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
                      const feeAmt = `$${formatPriceExact(job.cancellation_fee)}`;
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
                              ? "hsl(var(--amber-ink))"
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
                    Re-post this job
                  </Button>
                </div>
              )}

              {/* Accepted status */}
              {job.status === "accepted" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {job.helper_confirmed_at
                      ? <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} accepted</span>
                      : <span className="text-ds-11 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1" style={{ background: "hsl(var(--amber-tint) / 0.10)", color: "hsl(var(--amber-ink))" }}><Clock className="w-3 h-3" /> Waiting for {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} to accept</span>
                    }
                  </div>
                  {/* Job countdown */}
                  <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
                  {job.helper_confirmed_at && (
                    <div className="space-y-1.5">
                      {job.helper_arrived_at && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm" style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}>
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                            <span className="ml-auto text-ds-10 text-muted-foreground">{new Date(job.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          {job.poster_confirmed_arrival_at ? (
                            <span className="text-ds-11 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1" style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}><Check className="w-3 h-3" strokeWidth={3} /> Arrival confirmed</span>
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
                <span className="text-ds-11 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1" style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}><Check className="w-3 h-3" strokeWidth={3} /> Arrival confirmed</span>
              )}

              {/* Completion confirmation */}
              {(job.status === "in_progress" || job.status === "revision_requested") && (job.poster_completed_at || job.helper_completed_at) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> You confirmed</span>}
                  {job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" strokeWidth={3} /> {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>}
                  {!job.poster_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for you</span>}
                  {!job.helper_completed_at && <span className="text-ds-11 px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"}</span>}
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
                <div className="p-2 rounded-ds-sm border space-y-1.5" style={{ background: "hsl(var(--amber-tint) / 0.10)", borderColor: "hsl(var(--amber-tint) / 0.20)" }}>
                  <p className="text-ds-11 flex items-center gap-1" style={{ color: "hsl(var(--amber-ink))" }}><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                  {job.revision_note && <p className="text-ds-11 text-muted-foreground">{job.revision_note}</p>}
                  {job.revision_completed_at && (
                    <div className="p-1.5 rounded border" style={{ background: "hsl(var(--success-tint))", borderColor: "hsl(var(--success-border))" }}>
                      <p className="text-ds-11 font-medium inline-flex items-center gap-1" style={{ color: "hsl(var(--success-ink))" }}><Check className="w-3 h-3" strokeWidth={3} /> Helpr marked revision as fixed</p>
                      {job.revision_acceptance_deadline && (
                        <DeadlineCountdown
                          deadline={job.revision_acceptance_deadline}
                          expiredText="Acceptance deadline passed — payment releasing to Helpr"
                          consequenceText="Accept the fix, or dispute. If no action is taken, payment auto-releases to the Helpr."
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
                  variant="bark"
                  size="sm"
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
              {(job.photos || []).length > 0 && (
                <div className="px-4 py-3 space-y-3 border-t border-border/30">
                  <div>
                    <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                    <JobCardPhotoStrip urls={job.photos || []} size="md" />
                  </div>
                </div>
              )}

              {/* Features for active jobs */}
              {(job.status === "in_progress" || job.status === "accepted") && (
                <div className="px-4 pb-3 space-y-3">
                  <JobConfirmation jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
                  {job.is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner={true} initialHelpers={initialGroupHelpers} />}

                </div>
              )}

              {/* Applicants button + inline expanded applicant list */}
              {job.status === "open" && (
                <PostedJobApplicants
                  job={job}
                  userId={userId}
                  isExpanded={isExpanded}
                  applicantCounts={applicantCounts}
                  inlineApplicants={inlineApplicants}
                  loadingApplicants={loadingApplicants}
                  applicantErrors={applicantErrors}
                  onLoadApplications={onLoadApplications}
                  onLoadInlineApplicants={onLoadInlineApplicants}
                />
              )}

              {/* Analytics mini-panel — reach/views readout. The applicant
                  count is intentionally NOT shown here: the Applicants button
                  already surfaces it, so repeating it as "N applied" is noise. */}
              {jobAnalytics && jobAnalytics.viewCount > 0 && (
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
                    {jobAnalytics.conversionRate !== null && (
                      <span className="text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.55)" }}>
                        {jobAnalytics.conversionRate}% applied
                      </span>
                    )}
                  </div>
                  {/* Bid range — only for accept_bids jobs */}
                  {jobAnalytics.bidAvg !== null && (
                    <p className="text-ds-11" style={{ color: "hsl(var(--ink-deep) / 0.55)" }}>
                      Bids: ${formatPrice(jobAnalytics.bidMin ?? 0)}–${formatPrice(jobAnalytics.bidMax ?? 0)} · avg ${formatPrice(jobAnalytics.bidAvg)}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <PostedJobActions
                job={job}
                userId={userId}
                helperNames={helperNames}
                completedJobMeta={completedJobMeta}
                startRequestedJobIds={startRequestedJobIds}
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
                confirmingStartJobId={confirmingStartJobId}
                onConfirmArrival={onConfirmArrival}
                confirmingArrivalJobId={confirmingArrivalJobId}
                onConfirmWorking={onConfirmWorking}
                confirmingWorkingJobId={confirmingWorkingJobId}
                onActionComplete={onActionComplete}
              />
            </div>
            )}
          </JobCardShell>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const PostedJobCard = memo(PostedJobCardInner);
