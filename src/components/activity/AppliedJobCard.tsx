import { memo, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Star, Users,
  RefreshCw, XCircle,
  ChevronUp, ChevronDown, Eye, Pencil,
} from "lucide-react";
import { PhotoProofGroup } from "@/components/PhotoProof";
import type { AppliedApp } from "./activityConstants";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobActionRow, JobActionChip } from "./JobActionRow";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { SendReportCard } from "./PetReportCard";
import { formatPrice, formatPriceFloor, formatShortDate, formatRecurrenceInterval } from "@/lib/format";
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
  // The viewing helper's own tier rate. Only consulted when the job carries no
  // stamped helper_fee_percent — see the fee-precedence note in the helper.
  const { profile: viewerProfile } = useCurrentUser();
  const viewerFeePercent = tierFeePercent(
    viewerProfile?.subscription_tier,
    viewerProfile?.subscription_expires_at ?? null,
  );

  const [showReportCard, setShowReportCard] = useState(false);

  useHighlightPulse(highlight, cardRef);

  // `poster_viewed_at` isn't in the generated types yet (migration lag);
  // read it through this narrow view rather than `as any`.
  const viewedApp = app as AppliedApp & ApplicationViewFields;
  const job = app.job;
  if (!job) {
    // An application can outlive its job row's VISIBILITY: once the job
    // closes to another helper, the jobs SELECT policy hides it from a
    // rejected applicant, so `app.job` comes back null. The bucket counts
    // (activityFilters) still tally this application under Done — a silent
    // `null` here is what made the Done badge read 3 over a list of 2
    // cards. Render the same minimal "Not selected" card, minus the job
    // details we can no longer read.
    return (
      <div ref={cardRef}>
        <JobCardShell expandable={false} expanded={false} onToggle={() => {}}>
          <div className="px-4 py-3 space-y-1">
            <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              {app.status === "rejected" ? "Not selected" : "Job no longer available"}
            </p>
            <p className="text-ds-11 text-muted-foreground italic">
              This job has closed, so its details aren’t available any more.
            </p>
          </div>
        </JobCardShell>
      </div>
    );
  }
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
    hasActionSection,
  } = deriveAppliedJobCardState(
    app,
    job,
    helperReviewedJobIds,
    expandedJobId,
    // The viewer's own tier rate, used only when the job has no rate stamped
    // on it yet — see the fee-precedence note in appliedJobCardHelpers.
    viewerFeePercent,
  );

  /**
   * Location · date · time — built once, placed twice. Desktop puts it on the
   * TITLE row; phone keeps it below. Mirrors PostedJobCard exactly, which is
   * the point: these two cards sit in the same two tabs of the same screen.
   */
  const metaRow = (
            <JobCardMetaRow
              dateNeeded={job.date_needed}
              startTime={job.start_time}
              location={job.location}
              latitude={job.latitude}
              longitude={job.longitude}
              expiresAt={isPending && !job.helper_id ? job.expires_at : null}
            />
  );

  return (
    <>
        <div ref={cardRef}>
        <JobCardShell
          expandable={!isMinimalCard}
          expanded={isExpanded}
          onToggle={() => setExpandedJobId(isExpanded ? null : app.job_id)}
          category={job.category}
        >
          <JobCardTitleBar
            title={job.title || "Job"}
            category={job.category}
            // FLOORED, matching JobPrice (owner, 2026-08-19: the headline
            // take-home floors — a payout figure may never read above the
            // payout). Browse, the job-detail pill and this card all quote
            // the same whole-dollar floor; only breakdown line items keep
            // exact cents, because those must visibly add up.
            amount={formatPriceFloor(payout)}
            amountTitle={`Budget: $${formatPrice(job.budget ?? 0)} · Fee: ${commissionPercent}%`}
            meta={metaRow}
          />

          {/* NO STATUS BAND — the filter tabs say it (owner: "remove"). Same
              removal the posted card took: with Needs you / Scheduled /
              Waiting / Done at the top of the list, a coloured band on every
              card repeats the tab the reader is standing in, once per card,
              all the way down. */}

          {/* ONE TRACKER IN THE APP (owner: "remove this tracker globally,
              there should only be the other live tracker").

              This card used to open with a FOUR-step escrow bar — Paid /
              Working / Verified / Released — while the poster's card for the
              same job opened with the eight-step live tracker. Two different
              progress strips, different lengths, different vocabularies, on
              the two halves of one job; a helpr and a poster looking at the
              same work saw two different pictures of where it was.

              The live tracker below is the one that survives: it is about the
              WORK, which is what both sides are actually tracking, and it
              already carries the escrow milestones implicitly (Done is the
              moment payment is released). Where the money sits is a fact for
              the payout screen, not a second timeline on a job card. */}

          {/* Summary info line. The expand control rides the END of this row
              as a bare chevron — owner: "move the details arrow up and remove
              the words details". It used to be a labelled "View details ⌄"
              button on its own row below, which spent a full 44px band and two
              words saying what a chevron says on its own. The accessible name
              stays on `aria-label`, because a bare glyph has none. */}
          {/* `pb-1.5` when an action section follows, `py-3` otherwise. The
              meta block's bottom padding and the action block's top padding
              stacked to ~48px of dead band with a hairline through the middle,
              directly above the Accept/Decline pair. Same trim the posted card
              makes. */}
          <div className={`px-4 pt-2.5 space-y-2 ${hasActionSection && !isMinimalCard ? "pb-1.5" : "pb-3"}`}>
            {/* The chevron goes through JobCardMetaRow's own `trailing` slot,
                which exists for exactly this and is what PostedJobCard uses.
                This card wrapped the meta row in a bespoke flex and hung its
                own button outside — two sibling cards in the same tab, same
                control, different structure. The glyph is one rotating
                ChevronDown now too, copied from PostedJobCard: swapping
                ChevronUp/ChevronDown with no transition made the identical
                control animate on one card and snap on the other. */}

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
            {/* Who posted it lives INSIDE the details now (owner: "posted by
                can be moved to details here"). On a collapsed card it was a
                permanent line for something the helper only needs when they
                are actually weighing the job — and it was the reason the row
                below existed at all. */}
            {!isMinimalCard && isExpanded && app.posterName && (
              <p className="text-ds-11 text-muted-foreground truncate">
                Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
              </p>
            )}
            {!isMinimalCard && isExpanded && job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
              <p className="text-ds-11 text-muted-foreground leading-relaxed">{job.description}</p>
            )}

            {isMinimalCard && (
              <div className="space-y-2">
                <p className="text-ds-11 text-muted-foreground italic">{isCancelled ? "Job was cancelled" : "Not selected"}</p>
                {isCancelled && <CancellationFeePill job={job} fallbackFeePercent={viewerFeePercent} />}
                {/* No "Browse Open Jobs" button (owner: "remove"). A full-size
                    control on every not-selected card repeated the Home tab one
                    tap away — an archived rejection doesn't need a CTA. */}
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
                // The date was in a `title=` only. Touch has no hover, and iOS
                // is the primary surface, so on the device most helpers use
                // there was no route to it at all. It's short enough to just
                // say.
                <span
                  className="flex items-center gap-1 text-ds-10 font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  <Eye className="w-3 h-3" aria-hidden="true" /> Seen {formatShortDate(viewedApp.poster_viewed_at)}
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
