import { memo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Star, Users,
  RefreshCw, XCircle,
  ChevronUp, ChevronDown, Eye,
} from "lucide-react";
import { PhotoProofGroup } from "@/components/PhotoProof";
import type { AppliedApp } from "./activityConstants";
import { EscrowProgressBar } from "@/components/payment/EscrowProgressBar";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { SendReportCard } from "./PetReportCard";
import { formatPrice, formatShortDate } from "@/lib/format";
import type { AppliedJobCardProps, NegotiationFields } from "./appliedJobCard/types";
import { useHighlightPulse } from "./appliedJobCard/useHighlightPulse";
import { useCounterOfferResponse } from "./appliedJobCard/useCounterOfferResponse";
import { deriveAppliedJobCardState } from "./appliedJobCard/appliedJobCardHelpers";
import { CancellationFeePill } from "./appliedJobCard/CancellationFeePill";
import { PendingApplicationSection } from "./appliedJobCard/PendingApplicationSection";
import { CounterOfferBar } from "./appliedJobCard/CounterOfferBar";
import { OfferedActions } from "./appliedJobCard/OfferedActions";
import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";
import { ActiveJobSection } from "./appliedJobCard/ActiveJobSection";
import { DisputedSection } from "./appliedJobCard/DisputedSection";

/**
 * AppliedJobCard — one card in the helper's "applied jobs" feed: the
 * job summary plus the state-specific section (pending / offered /
 * confirmed / in-progress / disputed / completed) and its actions.
 *
 * Extracted verbatim from AppliedJobsTab.tsx (which was a 989-line file
 * whose bulk was this one render function). Faithful relocation — the
 * JSX is unchanged; every value the card read from the parent is now a
 * prop. The parent still owns the state + handlers and threads them in.
 */
function AppliedJobCardInner({
  app,
  highlight = false,
  expandedJobId,
  setExpandedJobId,
  helperReviewedJobIds,
  initialTracking,
  userId,
  onHelperResponse,
  onComplete,
  completingJobId,
  onResolveRevision,
  onHelperReview,
  onDispute,
  onViewDispute,
  onRefresh,
  disputeResponse,
  setDisputeResponse,
  respondingJobId,
  setRespondingJobId,
  submittingResponse,
  setSubmittingResponse,
  withdrawingAppId,
  setWithdrawTarget,
  uploadingAttachment,
  editingMessageAppId,
  setEditingMessageAppId,
  editMessageText,
  setEditMessageText,
  savingMessage,
  handleSaveMessage,
  handleAddAttachment,
  handleRemoveAttachment,
}: AppliedJobCardProps) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [showReportCard, setShowReportCard] = useState(false);

  useHighlightPulse(highlight, cardRef);

  const { counterResponding, localCounterStatus, handleRespondCounter } = useCounterOfferResponse();

  // Negotiation columns aren't in the generated types yet (migration lag);
  // read them through this narrow view rather than `as any`.
  const bidApp = app as AppliedApp & NegotiationFields;
  const job = app.job;
  if (!job) return null;
  const {
    status,
    isOffered,
    isConfirmed,
    isActive,
    isDisputed,
    isCompleted,
    isCancelled,
    isPending,
    isFullyDone,
    isExpanded,
    commissionPercent,
    payout,
    isMinimalCard,
    escrowStep,
  } = deriveAppliedJobCardState(app, job, helperReviewedJobIds, expandedJobId);

  return (
    <>
        <div ref={cardRef}>
        <JobCardShell
          expandable={!isMinimalCard}
          expanded={isExpanded}
          onToggle={() => setExpandedJobId(isExpanded ? null : app.job_id)}
        >
          <JobCardTitleBar
            title={job.title || "Job"}
            amount={formatPrice(payout)}
            amountTitle={`Budget: $${job.budget} · Fee: ${commissionPercent}%`}
          />

          {/* Escrow progress — gives the helpr context on where the
              customer's payment sits in the lifecycle (held / verified /
              released). Sits above the action area for high context
              without nudging. Hides itself when escrow does not apply. */}
          {escrowStep && (
            <div className="px-4 pt-3" onClick={(e) => e.stopPropagation()}>
              <EscrowProgressBar currentStep={escrowStep} compact />
            </div>
          )}

          {/* Summary info line */}
          <div className="px-4 py-3 space-y-2.5">
            <JobCardMetaRow
              dateNeeded={job.date_needed}
              startTime={job.start_time}
              location={job.location}
              latitude={job.latitude}
              longitude={job.longitude}
              estimatedHours={job.estimated_hours}
              expiresAt={isPending && !job.helper_id ? job.expires_at : null}
            />

            {/* Description preview — clamped while collapsed to keep cards
                compact, un-clamped once the card is expanded so the full
                brief shows inline (this card IS the detail surface for an
                applied job; there is no separate signed-in detail page). */}
            {!isMinimalCard && job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
              <p className={`text-ds-11 text-muted-foreground leading-relaxed ${isExpanded ? "" : "line-clamp-2"}`}>{job.description}</p>
            )}
            {!isMinimalCard && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : app.job_id); }}
                aria-expanded={isExpanded}
                className="inline-flex items-center gap-0.5 text-ds-11 font-medium text-primary hover:underline active:opacity-70"
              >
                {isExpanded
                  ? <>Hide details <ChevronUp className="w-3 h-3" /></>
                  : <>View details <ChevronDown className="w-3 h-3" /></>}
              </button>
            )}

            {/* Poster name */}
            {!isMinimalCard && app.posterName && (
              <p className="text-ds-11 text-muted-foreground">
                Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
              </p>
            )}
            {isMinimalCard && (
              <div className="space-y-1.5">
                <p className="text-ds-11 text-muted-foreground italic">{isCancelled ? "Job was cancelled" : "Not selected"}</p>
                {isCancelled && <CancellationFeePill job={job} />}
              </div>
            )}
          </div>

          {/* Pending expandable section */}
          {!isMinimalCard && isPending && isExpanded && (
            <PendingApplicationSection
              app={app}
              job={job}
              uploadingAttachment={uploadingAttachment}
              editingMessageAppId={editingMessageAppId}
              setEditingMessageAppId={setEditingMessageAppId}
              editMessageText={editMessageText}
              setEditMessageText={setEditMessageText}
              savingMessage={savingMessage}
              handleSaveMessage={handleSaveMessage}
              handleAddAttachment={handleAddAttachment}
              handleRemoveAttachment={handleRemoveAttachment}
            />
          )}

          {/* Counter-offer notification bar — only shown when the poster
              has sent a counter price. The helper can accept or decline
              directly from this bar without opening the full detail view.
              Uses optimistic local state so the response is reflected
              immediately (no reload needed). */}
          {!isMinimalCard && isPending && (
            <CounterOfferBar
              app={app}
              bidApp={bidApp}
              localCounterStatus={localCounterStatus}
              counterResponding={counterResponding}
              handleRespondCounter={handleRespondCounter}
            />
          )}

          {/* Pending withdraw — slightly more discoverable than the
              previous ghost text. Tucked inside a sienna-tinted pill
              that reads as "available, low-stakes" without competing
              with primary actions. */}
          {!isMinimalCard && isPending && (
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Seen" trust chip — visible when the poster has opened
                  the applicant list and viewed this application. Subtle
                  olivewood colour so it reads as informational, not urgent. */}
              {bidApp.poster_viewed_at ? (
                <span
                  className="flex items-center gap-0.5 text-ds-10 font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  title={`Poster viewed on ${formatShortDate(bidApp.poster_viewed_at)}`}
                >
                  <Eye className="w-3 h-3" aria-hidden="true" /> Seen
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={withdrawingAppId === app.id}
                onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "Job", jobId: job.id ?? null })}
                className="inline-flex items-center gap-1.5 text-[0.72rem] font-sans font-semibold tracking-wide px-2.5 py-1 rounded-full active:opacity-70 transition-opacity disabled:opacity-50"
                style={{
                  color: "hsl(var(--burnt-sienna))",
                  background: "hsl(var(--burnt-sienna) / 0.08)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                <XCircle className="w-3.5 h-3.5" strokeWidth={2.25} />
                {withdrawingAppId === app.id ? "Withdrawing…" : "Withdraw application"}
              </button>
            </div>
          )}

          {/* === ACTION SECTIONS === */}

          {/* Offered: accept/decline — celebratory framing since this
              is a poster reaching out directly. Gold-warm accent
              surfaces the "you were picked" moment without shouting. */}
          {isOffered && (
            <OfferedActions app={app} job={job} onHelperResponse={onHelperResponse} />
          )}

          {/* Confirmed: show tracking + message */}
          {isConfirmed && (
            <ConfirmedSection
              app={app}
              job={job}
              userId={userId}
              initialTracking={initialTracking}
              navigate={navigate}
            />
          )}

          {/* In Progress / Revision */}
          {isActive && (
            <ActiveJobSection
              app={app}
              job={job}
              status={status}
              userId={userId}
              initialTracking={initialTracking}
              completingJobId={completingJobId}
              onComplete={onComplete}
              onResolveRevision={onResolveRevision}
              navigate={navigate}
              setShowReportCard={setShowReportCard}
            />
          )}

          {/* Disputed */}
          {isDisputed && (
            <DisputedSection
              app={app}
              job={job}
              navigate={navigate}
              onViewDispute={onViewDispute}
              onRefresh={onRefresh}
              disputeResponse={disputeResponse}
              setDisputeResponse={setDisputeResponse}
              respondingJobId={respondingJobId}
              setRespondingJobId={setRespondingJobId}
              submittingResponse={submittingResponse}
              setSubmittingResponse={setSubmittingResponse}
            />
          )}

          {/* Completed - not yet reviewed: always show photo proof + review button */}
          {isCompleted && !isFullyDone && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <PhotoProofGroup
                jobId={app.job_id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUpload={false}
              />
              {job.payment_status === "released" && (
                helperReviewedJobIds.has(app.job_id) ? (
                  <Button size="sm" variant="outline" className="w-full" disabled><Star className="w-4 h-4 mr-1" /> Reviewed</Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => onHelperReview(app.job_id, job.customer_id, app.posterName || "Poster")}>
                    <Star className="w-4 h-4 mr-1" /> Review Poster
                  </Button>
                )
              )}
              {/* Issue #113 — discoverable dispute path for helpers within
                  the 7-day window after completion. Self-hides outside the
                  window or once a dispute is already filed. */}
              <DisputeLink
                job={job}
                side="helper"
                onOpenDispute={() => onDispute(job)}
              />
            </div>
          )}

          {/* Fully reviewed completed jobs still get the dispute link until
              the 7-day window closes — issue #113. Helpers may not realize
              there's a problem until after they've left a review. */}
          {isFullyDone && (
            <DisputeLink
              job={job}
              side="helper"
              onOpenDispute={() => onDispute(job)}
              className="px-4 pb-2"
            />
          )}

          {/* Fully done (reviewed) - collapsible */}
          {isFullyDone && (
            <div className="px-4 py-1.5 border-t border-[hsl(var(--olivewood)/0.1)] bg-card flex items-center justify-between">
              <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Reviewed</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </div>
          )}
          {isFullyDone && isExpanded && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <PhotoProofGroup
                jobId={app.job_id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUpload={false}
              />
            </div>
          )}


          {/* Footer: extra details (photos, requirements, group/recurring) */}
          {!isMinimalCard && (!isFullyDone || isExpanded) && ((job.photos || []).length > 0 || job.is_recurring || job.is_group_job) && (
            <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
              <JobCardPhotoStrip urls={job.photos || []} size="sm" />
              {job.is_recurring && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <RefreshCw className="w-3 h-3 text-primary" />
                  <span>{job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}{job.recurrence_end_date && ` until ${formatShortDate(job.recurrence_end_date)}`}</span>
                </div>
              )}
              {job.is_group_job && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <Users className="w-3 h-3 text-primary" />
                  <span>{job.helpers_needed ? `${job.helpers_needed} Helprs needed` : "Group job"}</span>
                </div>
              )}
            </div>
          )}
        </JobCardShell>
        </div>

      {/* Pet report card sheet — mounted outside JobCardShell to avoid
          z-index clipping inside the card's overflow:hidden container */}
      {showReportCard && job.customer_id && (
        <SendReportCard
          jobId={app.job_id}
          helperId={userId}
          ownerId={job.customer_id}
          onClose={() => setShowReportCard(false)}
        />
      )}
    </>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const AppliedJobCard = memo(AppliedJobCardInner);
