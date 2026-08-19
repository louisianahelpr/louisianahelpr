import { memo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Star, Users,
  RefreshCw, XCircle,
  ChevronUp, ChevronDown, Eye, Pencil,
} from "lucide-react";
import { PhotoProofGroup } from "@/components/PhotoProof";
import type { AppliedApp } from "./activityConstants";
import { EscrowProgressBar } from "@/components/payment/EscrowProgressBar";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobCardStatusStripe } from "./JobCardStatusStripe";
import { appliedCardState } from "./activityStateLabel";
import { JobActionRow, JobActionChip } from "./JobActionRow";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { SendReportCard } from "./PetReportCard";
import { formatPrice, formatShortDate, formatRecurrenceInterval } from "@/lib/format";
import type { AppliedJobCardProps, ApplicationViewFields } from "./appliedJobCard/types";
import { useHighlightPulse } from "./appliedJobCard/useHighlightPulse";
import { deriveAppliedJobCardState } from "./appliedJobCard/appliedJobCardHelpers";
import { CancellationFeePill } from "./appliedJobCard/CancellationFeePill";
import { PendingApplicationSection } from "./appliedJobCard/PendingApplicationSection";
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
  respondingHelperAppId,
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

  // `poster_viewed_at` isn't in the generated types yet (migration lag);
  // read it through this narrow view rather than `as any`.
  const viewedApp = app as AppliedApp & ApplicationViewFields;
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
    hasActionSection,
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

          {/* Whose move is it? — the same full-width band the posted card
              carries, so the two halves of Activity read as one system. These
              are APPLICATION states, not job states ("Not selected" is a fact
              about this application; the job itself may still be open), but
              they come from the same single status→tone mapping. Sits directly
              under the title/price divider on BOTH card types. */}
          <JobCardStatusStripe
            state={appliedCardState({
              status: app.status,
              job: {
                status: job.status,
                helper_confirmed_at: job.helper_confirmed_at,
                offered_to_helper_id: job.offered_to_helper_id,
                direct_offer_status: job.direct_offer_status,
              },
            })}
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

            {/* Description behind a tap — expands IN PLACE on this card (it IS
                the detail surface for an applied job; there is no separate
                signed-in detail page).

                This card already had a "View details" control, but it sat
                BELOW a description that was already fully readable, so the
                toggle appeared to promise something it had mostly already
                shown. There is still exactly ONE affordance — the same
                `expandedJobId` toggle, unchanged in wording and position — it
                simply now gates the description too, which is what makes it
                coherent. Nothing was bolted on beside it. */}
            {!isMinimalCard && isExpanded && job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
              <p className="text-ds-11 text-muted-foreground leading-relaxed">{job.description}</p>
            )}

            {/* "Posted by" and the details toggle share ONE row.
                They used to be two stacked bands — a 44px toggle row, then a
                separate 17px "Posted by" line — which, with the status stripe,
                the meta row and the action row, made five stacked bands for one
                applied job and stopped two cards fitting on a 375 screen
                together. They are both single-line, both secondary, and one is
                naturally left-aligned and the other right: one row, ~44px total
                instead of ~71px, with no information removed.

                The toggle keeps its ≥44px target (it sets the row's height),
                and it keeps `aria-expanded` + an explicit accessible name — the
                visible words alone ("View details") do not say WHAT expands. */}
            {!isMinimalCard && (
              <div className="flex items-center gap-2 min-w-0">
                {app.posterName && (
                  <p className="text-ds-11 text-muted-foreground truncate min-w-0">
                    Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
                  </p>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : app.job_id); }}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Hide job description" : "Show job description"}
                  className="ml-auto shrink-0 inline-flex items-center gap-0.5 min-h-[44px] px-1 -mr-1 text-ds-11 font-medium text-primary hover:underline active:opacity-70"
                >
                  {isExpanded
                    ? <>Hide details <ChevronUp className="w-3 h-3" /></>
                    : <>View details <ChevronDown className="w-3 h-3" /></>}
                </button>
              </div>
            )}
            {isMinimalCard && (
              <div className="space-y-2">
                <p className="text-ds-11 text-muted-foreground italic">{isCancelled ? "Job was cancelled" : "Not selected"}</p>
                {isCancelled && <CancellationFeePill job={job} />}
                {/* Rejection is the most deflating moment on the helper side —
                    never leave it a dead end. Offer the obvious next step. */}
                {!isCancelled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-ds-md"
                    onClick={(e) => { e.stopPropagation(); navigate("/dashboard"); }}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" /> Browse open jobs
                  </Button>
                )}
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

          {/* Pending actions — Edit alongside Withdraw, in the same
              icon-over-label chip row the posted card uses.

              Withdraw used to be the only thing here, and it was the only thing
              a waiting applicant could do: pull out entirely. The owner asked
              for the obvious middle option — "they should be able to edit app
              and withdraw" — and the editing surface already existed, it was
              just unreachable without knowing that "View details" hides it.
              PendingApplicationSection (rendered above, gated on `isExpanded`)
              owns the message editor, the bid editor and the attachment list;
              this chip expands the card AND opens the message editor, so Edit
              lands the user IN the editor rather than merely near it. No new
              editing surface was invented.

              Two chips at 2-up cost exactly the height one chip cost at 1-up,
              so the added affordance is free in vertical space. Withdraw keeps
              the destructive tint so it never reads as a neutral "next step";
              Edit takes the ordinary `edit` tone the posted card's Edit chip
              already uses. The "Seen" trust chip is unchanged — it is
              information, not an action. */}
          {!isMinimalCard && isPending && (
            <div
              className="px-4 py-2.5 space-y-1.5"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Seen" trust chip — visible when the poster has opened
                  the applicant list and viewed this application. Subtle
                  olivewood colour so it reads as informational, not urgent. */}
              {viewedApp.poster_viewed_at && (
                <span
                  className="flex items-center gap-0.5 text-ds-10 font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  title={`Poster viewed on ${formatShortDate(viewedApp.poster_viewed_at)}`}
                >
                  <Eye className="w-3 h-3" aria-hidden="true" /> Seen
                </span>
              )}
              <JobActionRow columns={2}>
                <JobActionChip
                  icon={Pencil}
                  label="Edit"
                  ariaLabel="Edit your application"
                  tone="edit"
                  onClick={() => {
                    setExpandedJobId(app.job_id);
                    setEditingMessageAppId(app.id);
                    setEditMessageText(app.message || "");
                  }}
                />
                <JobActionChip
                  icon={XCircle}
                  label={withdrawingAppId === app.id ? "Withdrawing…" : "Withdraw"}
                  ariaLabel="Withdraw application"
                  tone="danger"
                  disabled={withdrawingAppId === app.id}
                  onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "Job", jobId: job.id ?? null })}
                />
              </JobActionRow>
            </div>
          )}

          {/* === ACTION SECTIONS === */}

          {/* Offered: accept/decline — celebratory framing since this
              is a poster reaching out directly. Gold-warm accent
              surfaces the "you were picked" moment without shouting. */}
          {isOffered && (
            <OfferedActions app={app} job={job} onHelperResponse={onHelperResponse} respondingHelperAppId={respondingHelperAppId} />
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


          {/* Last resort: a live application that matched NO action section.
              Two cards in visibly the same state, one with a Withdraw button
              and one with nothing under it, is what the owner reported — and
              the blank one was not "no actions available", it was a state the
              card had no branch for. The branch gap itself is fixed above
              (`isAssigned` now trusts the application's own status), but a card
              must never again go silent: if some future status slips through,
              say so rather than rendering an empty band. */}
          {!isMinimalCard && !hasActionSection && (
            <div
              className="px-4 py-2.5"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
            >
              <p className="text-ds-11 text-muted-foreground">
                No actions available on this application right now — open the job to see where it stands.
              </p>
            </div>
          )}

          {/* Footer: extra details (photos, requirements, group/recurring) */}
          {!isMinimalCard && (!isFullyDone || isExpanded) && ((job.photos || []).length > 0 || job.is_recurring || job.is_group_job) && (
            <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
              <JobCardPhotoStrip urls={job.photos || []} size="sm" />
              {job.is_recurring && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <RefreshCw className="w-3 h-3 text-primary" />
                  <span>{formatRecurrenceInterval(job.recurrence_interval)}{job.recurrence_end_date && ` until ${formatShortDate(job.recurrence_end_date)}`}</span>
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
