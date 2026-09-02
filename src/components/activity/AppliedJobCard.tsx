import { memo, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, Star,
  RefreshCw, XCircle,
  Eye, Pencil,
} from "lucide-react";
import { PhotoProofGroup } from "@/components/PhotoProof";
import type { AppliedApp } from "./activityConstants";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobActionRow, JobActionChip } from "./JobActionRow";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { formatPrice, formatPriceFloor, formatShortDate, formatRecurrenceInterval } from "@/lib/format";
import type { AppliedJobCardProps, ApplicationViewFields } from "./appliedJobCard/types";
import { useHighlightPulse } from "./useHighlightPulse";
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
  expandedJobIds,
  toggleExpandedJobId,
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
    expandedJobIds,
    // The viewer's own tier rate, used only when the job has no rate stamped
    // on it yet — see the fee-precedence note in appliedJobCardHelpers.
    viewerFeePercent,
  );

  /** The poster, or null on a job whose poster deleted their account — deletion
   *  anonymises the job rather than removing it (20260901033011), so it stands
   *  with no owner and no address. Narrowed HERE, into a local, because reading
   *  `job.customer_id` again inside a callback re-widens it. */
  const posterId = job.customer_id;

  /** Does the description say anything the TITLE hasn't already said? A job
   *  whose description is its own title back again is one line of duplication. */
  const showDescription =
    !isMinimalCard &&
    isExpanded &&
    job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase();
  /** Whether the block between the meta row and the action row has ANY content.
   *  Every child of it is conditional — see the note at the block itself. */
  const hasCardBody = !isMinimalCard && isExpanded && (!!app.posterName || showDescription);

  /**
   * Location · date · time — built once, placed twice. Desktop puts it on the
   * TITLE row; phone keeps it below. Mirrors PostedJobCard exactly, which is
   * the point: these two cards sit in the same two tabs of the same screen.
   */
  const metaRow = (
    <>
      {/* Issue #67 — who posted it used to be readable only after expanding
          (the full "Posted by" row below, or a state-section tracker). A
          collapsed card is what most of the list looks like, so the name was
          invisible for most of the scroll. Same avatar-badge treatment as the
          expanded row below, shrunk to fit the title bar; hidden once expanded
          so the two don't say the same thing twice — the fuller row (with the
          profile link) takes over from there. */}
      {!isExpanded && app.posterName && (
        <div className="flex items-center gap-1 mb-1">
          <div className="w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-9 font-bold shrink-0">
            {app.posterName[0].toUpperCase()}
          </div>
          <span className="text-ds-11 text-muted-foreground truncate">{app.posterName}</span>
        </div>
      )}
      <JobCardMetaRow
        dateNeeded={job.date_needed}
        startTime={job.start_time}
        /* An anonymised job carries no address (see `posterId` above); the
           location chip's own normaliser already treats "" as absent. */
        location={job.location ?? ""}
        latitude={job.latitude}
        longitude={job.longitude}
        expiresAt={isPending && !job.helper_id ? job.expires_at : null}
        /* "👥 3", inline right after the time (owner, 2026-08-30: "3 helprs
           needed goes to the right of time"). It used to be a line of its own
           at the very BOTTOM of the card, under the Edit/Withdraw row, in the
           photos/recurring footer — a fact about the JOB stranded below the
           helper's own actions, reading like small print. The browse feed
           already stated it in the meta row; this is the same chip, in the
           same place, on both surfaces. */
        helpersNeeded={job.is_group_job ? (job.helpers_needed ?? 2) : null}
      />
    </>
  );

  return (
    <>
        <div ref={cardRef}>
        <JobCardShell
          expandable={!isMinimalCard}
          expanded={isExpanded}
          onToggle={() => toggleExpandedJobId(app.job_id)}
          category={job.category}
        >
          <JobCardTitleBar
            title={job.title || "a task"}
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
          {/* THE BAND ONLY EXISTS IF IT HAS CONTENT (owner, 2026-08-30: "remove
              gap under the location and above the buttons").

              Every child of this block is conditional — the "Posted by" row and
              the description need `isExpanded`, the not-selected line needs
              `isMinimalCard` — so on a COLLAPSED pending card (the Waiting tab,
              the state the owner was looking at) it rendered an empty div with
              `pt-2.5 pb-1.5` of padding, directly above the action block's own
              `py-2.5` and its hairline top border. ~26px of white with a rule
              through it and nothing in it: it reads as a section that failed to
              render, not as spacing. The padding was always sized for content;
              when there is none the band collapses rather than reserving space
              for it. */}
          {(hasCardBody || isMinimalCard) && (
          <div className={`px-4 pt-2.5 space-y-2 ${hasActionSection && !isMinimalCard ? "pb-1.5" : "pb-3"}`}>
            {/* No chevron glyph on this card (owner: remove it) — the whole
                card is the expand/collapse tap target (JobCardShell), so no
                visible control is needed to say there's more. */}

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
            {/* Avatar-badge row — matches PostedJobCard's "Offered to
                {helper}" treatment (initial-letter circle + name link in a
                tinted pill) exactly, rather than a bare text line, so
                My Posts and My Jobs draw a "who's on the other side of
                this job" fact the same way. */}
            {!isMinimalCard && isExpanded && app.posterName && (
              <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-ds-sm bg-muted/40">
                <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-10 font-bold shrink-0">
                  {app.posterName[0].toUpperCase()}
                </div>
                <span className="text-ds-11 text-muted-foreground">Posted by</span>
                {/* An ownerless job still has a name to print — "a neighbor" —
                    but no profile behind it, and `/user/null` is not a page.
                    Plain text rather than a link that goes nowhere. */}
                {posterId ? (
                  <a href={`/user/${posterId}`} onClick={(e) => e.stopPropagation()} className="text-ds-11 font-medium text-primary hover:underline truncate">
                    {app.posterName}
                  </a>
                ) : (
                  <span className="text-ds-11 font-medium text-muted-foreground truncate">
                    {app.posterName}
                  </span>
                )}
              </div>
            )}
            {/* EYEBROW GONE AGAIN, and this time for good (owner, 2026-08-30:
                "remove eye brows" — reversing the same day's "eye brows were
                removed so update so they know what things are"). The
                burnt-sienna small-caps label read as a section masthead on a
                card that is one short passage of prose, and the apply screen
                the helper came from had already dropped exactly that treatment
                for exactly that reason (see ApplyBody's own note).

                What tells the two passages apart now is TYPE, not a heading:
                this one — the POSTER's description — is `text-ds-11` grey, and
                the helper's own message below is `text-ds-14` in
                `text-foreground`, the size and colour they typed it at on the
                apply screen. Small and grey is context; large and dark is
                yours.

                The <section> and its `aria-labelledby` are UNCHANGED — the
                heading is still there, still associated, just `sr-only`. A
                landmark with no accessible name is what the eyebrow was
                originally added to fix, and dropping the name would re-break
                that for a screen-reader user while fixing nothing visible. */}
            {showDescription && (
              <section aria-labelledby={`job-desc-${app.job_id}`} className="space-y-1">
                <h4 id={`job-desc-${app.job_id}`} className="sr-only">Job description</h4>
                <p className="text-ds-11 text-muted-foreground leading-relaxed">{job.description}</p>
              </section>
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
          )}

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
                    if (!isExpanded) toggleExpandedJobId(app.job_id);
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
                  onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "a task", jobId: job.id ?? null })}
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
              {/* Same icon-over-label chip PostedJobCard's completed state
                  uses for Review/Reviewed — this was a plain full-width
                  outline Button, the one place the two Done-tab cards
                  visibly diverged in style. */}
              {/* `payout_pending` counts too. Migration
                  20260825053000_reviews_allow_payout_pending.sql widened the
                  reviews INSERT policy to accept BOTH settlement states for
                  exactly this reason — payment_status only becomes 'released'
                  when the payout actually settles, ~24h later. The poster's
                  gate (PostedJobActions.tsx:533) was updated; the helper's was
                  not, so the helper was locked out for a full day while the
                  poster's review sat hidden behind feedback_visible_at waiting
                  for a counter-review that could not be written. */}
              {/* `posterId &&`: a review needs a reviewee. On an ownerless job
                  there is no account to address one to, and the INSERT would
                  fail on a null `reviewee_id` — so the chip doesn't render
                  rather than offering an action that cannot complete. */}
              {(job.payment_status === "released" || job.payment_status === "payout_pending") && posterId && (
                <JobActionRow columns={1}>
                  {helperReviewedJobIds.has(app.job_id) ? (
                    <JobActionChip
                      icon={CheckCircle2}
                      label="Reviewed"
                      ariaLabel="Already reviewed the poster"
                      tone="done"
                      disabled
                      onClick={() => {}}
                    />
                  ) : (
                    <JobActionChip
                      icon={Star}
                      label="Review Poster"
                      ariaLabel="Leave a review for the poster"
                      tone="edit"
                      onClick={() => onHelperReview(app.job_id, posterId, app.posterName || "Poster")}
                    />
                  )}
                </JobActionRow>
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
              {/* No chevron glyph here (owner: remove it) — the whole card is
                  still the expand/collapse tap target (see JobCardShell); only
                  the visible glyph is gone. */}
              <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Reviewed</span>
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
          {/* NO group-size line here any more — it moved into the meta row,
              inline after the time (owner: "3 helprs needed goes to the right
              of time"). It was the last item on the whole card, below the
              Edit/Withdraw chips, so a fact about the job was printed
              underneath the helper's own controls. See the `helpersNeeded`
              prop on JobCardMetaRow above. */}
          {!isMinimalCard && (!isFullyDone || isExpanded) && ((job.photos || []).length > 0 || job.is_recurring) && (
            <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
              <JobCardPhotoStrip urls={job.photos || []} size="sm" />
              {job.is_recurring && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <RefreshCw className="w-3 h-3 text-primary" />
                  <span>{formatRecurrenceInterval(job.recurrence_interval)}{job.recurrence_end_date && ` until ${formatShortDate(job.recurrence_end_date)}`}</span>
                </div>
              )}
            </div>
          )}
        </JobCardShell>
        </div>
    </>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const AppliedJobCard = memo(AppliedJobCardInner);
