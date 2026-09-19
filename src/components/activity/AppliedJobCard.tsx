import { memo, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, Star,
  RefreshCw, XCircle,
  Eye, Pencil, Image,
} from "lucide-react";
import { PhotoProofDialog } from "@/components/PhotoProof";
import type { AppliedApp } from "./activityConstants";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { PersonTile } from "@/components/PersonTile";
import { JobActionRow, JobActionChip } from "./JobActionRow";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { formatPrice, formatPriceFloor, formatShortDate, formatRecurrenceInterval } from "@/lib/format";
import type { AppliedJobCardProps, ApplicationViewFields } from "./appliedJobCard/types";
import { useHighlightPulse } from "./useHighlightPulse";
import { deriveAppliedJobCardState, describeCancellation } from "./appliedJobCard/appliedJobCardHelpers";
import { CancellationFeePill } from "./appliedJobCard/CancellationFeePill";
import { PendingApplicationSection } from "./appliedJobCard/PendingApplicationSection";
import { OfferedActions } from "./appliedJobCard/OfferedActions";
import { JobAddressLine } from "./appliedJobCard/JobAddressLine";
import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";
import { ActiveJobSection } from "./appliedJobCard/ActiveJobSection";
import { DisputedSection } from "./appliedJobCard/DisputedSection";
import { JobCardPersonContext, personSlotValue, useJobCardPersonSlot } from "./jobCardPerson";

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
  /* The before & after pictures are a BUTTON on the action row now, not a
     panel above it (owner item 10, 2026-09-19). ONE piece of state for the two
     places this card shows them: `completed but not reviewed` and `fully done
     and expanded` are mutually exclusive branches, so they can never both want
     the gallery open. */
  const [photosOpen, setPhotosOpen] = useState(false);
  // The viewing helper's own tier rate. Only consulted when the job carries no
  // stamped helper_fee_percent — see the fee-precedence note in the helper.
  const { profile: viewerProfile } = useCurrentUser();
  const viewerFeePercent = tierFeePercent(
    viewerProfile?.subscription_tier,
    viewerProfile?.subscription_expires_at ?? null,
  );


  useHighlightPulse(highlight, cardRef);

  /* The person slot, opened BEFORE the `if (!job)` early return below (rules
     of hooks). The tile is built once the card knows the poster. */
  const { claim: personClaim, stepCarriesTile } = useJobCardPersonSlot();

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
            <p className="text-ds-11 text-muted-foreground">
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

  /** Is there anything behind the Photos chip? Gated on the photos EXISTING,
   *  because the chip opens a dialog and an empty one is a dead-end tap. */
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;
  /** `payout_pending` counts too, and a review needs a reviewee — both rules
   *  are unchanged, just named once now that this gate decides a chip in a
   *  shared row rather than a row of its own. See the notes at the call site. */
  const canLeaveReview =
    (job.payment_status === "released" || job.payment_status === "payout_pending") && !!posterId;

  /** Does the description say anything the TITLE hasn't already said? A job
   *  whose description is its own title back again is one line of duplication. */
  const showDescription =
    !isMinimalCard &&
    isExpanded &&
    job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase();
  /** Whether the block between the meta row and the action row has ANY content.
   *  Every child of it is conditional — see the note at the block itself. */
  /* `app.posterName` used to count towards this, because the "Posted by" band
     lived in the body. It does not any more (the identity row sits in the meta
     block, collapsed or not), so counting it here would reserve a padded band
     for a child that no longer renders — the same empty-band defect
     STATUS_RENDERS_ACTIONS exists to stop on the poster's card. */
  /* THE POSTER'S PROFILE TILE, and WHO CARRIES IT.
     (owner, 2026-09-19: "the helpr or posted by should be right above the
     buttons" — the third position for this tile in five days; the history and
     the reasoning are in jobCardPerson.tsx.)

     MIRRORS THE POSTER CARD EXACTLY, and that is the point of routing it
     through the shared context: My Jobs and My Posts state the other party in
     the same place, in the same tile, by the same mechanism, rather than by
     two files agreeing with each other by hand.

     The old `trackerCarriesTile` — `isConfirmed || isActive || isDisputed`,
     a hand-copy of the three sections that mount HelperTrackerPanel — is gone.
     It was a second transcription of a render condition, and the asymmetry it
     existed for is worse on this card than on the poster's: the helper card
     has FIVE tracker-less states (pending, offered, completed, reviewed,
     cancelled) whose tile arrives by a different route, so a copy that fell
     out of date would silently delete the poster's profile from most of the
     card's states. `stepCarriesTile` is the shell REPORTING that it took the
     tile, so it cannot disagree with what actually rendered.

     Note that some of those five states mount no JobStepCard at all
     (PendingApplicationSection, OfferedActions and the minimal not-selected /
     cancelled card are not step cards), which is exactly when the body
     fallback below prints it.

     NOTHING WHILE COLLAPSED (V6). This card is the harder side of that rule —
     its tracker renders on a collapsed card while the poster's does not — so
     the gate is on the TILE here, before it is ever published, and not on any
     downstream consumer. */
  const posterTile =
    isExpanded && posterId && app.posterName ? (
      <PersonTile
        userId={posterId}
        to={`/user/${posterId}`}
        name={app.posterName}
        eyebrow="Posted by"
        onClick={(e) => e.stopPropagation()}
      />
    ) : null;
  const personCtx = personSlotValue(posterTile, personClaim);
  const bodyCarriesTile = !stepCarriesTile && posterTile !== null;
  // The expanded body also has to render for the poster PersonTile (V6), even
  // on a job with no description of its own to show — but only while the body
  // is the one printing it.
  const hasCardBody = showDescription || bodyCarriesTile;

  /**
   * Location · date · time — built once, placed twice. Desktop puts it on the
   * TITLE row; phone keeps it below. Mirrors PostedJobCard exactly, which is
   * the point: these two cards sit in the same two tabs of the same screen.
   */
  const metaRow = (
    <>
      {/* Who posted the job is NOT drawn in this little meta area any more.
          It is shown as a PersonTile UNDER the description when the card is
          expanded (owner V6, 2026-09-15: "same as the poster side") — matching
          VN-22, which moved the Helpr's profile out of exactly this spot into a
          tile under the description on the poster card, so the two cards state
          the other party the same way. See the PersonTile in the body below. */}
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
    /* The card publishes its own expand state to HelperTrackerPanel, which sits
       whichever JobStepCard this state mounts, through the shared person
       context (jobCardPerson.tsx). The provider wraps the WHOLE card so the
       body fallback below and the shell's claim are answering one question.
       The tile is already null while collapsed — see `posterTile` above. */
    <JobCardPersonContext.Provider value={personCtx}>
        <div ref={cardRef}>
        <JobCardShell
          expandable={!isMinimalCard}
          expanded={isExpanded}
          onToggle={() => toggleExpandedJobId(app.job_id)}
          category={job.category}
        >
          <JobCardTitleBar
            title={job.title || "a job"}
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
            {/* WHO POSTED THE JOB — a PersonTile under the description (owner
                V6, 2026-09-15: "same as the poster side"). VN-22 moved the
                other party's profile out of the little meta area into a tile
                here on the poster card; this mirrors it, so My Jobs and My
                Posts state the other party identically. Rendered just below the
                description, before the helper's own message. */}
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

            {/* The poster, as a PersonTile — the same shared tile the poster
                card uses for the Helpr (eyebrow "Posted by"). An ownerless job
                (`posterId` null after the poster deleted their account) has a
                name to print but no profile, so it is skipped rather than
                linking to `/user/null`. Avatar url isn't carried on this card's
                data, so PersonTile derives a monogram from the name.

                MOVED AGAIN (owner, 2026-09-19): it now sits directly above the
                action row, rendered by the step shell — see `posterTile` /
                `stepCarriesTile` above. This spot is the FALLBACK for the
                states that mount no step card at all (pending, offered, the
                minimal not-selected / cancelled card), so those keep the
                poster's profile rather than losing it with the row. Exactly
                one of the two ever renders. */}
            {bodyCarriesTile && posterTile}

            {isMinimalCard && (
              <div className="space-y-2">
                {/* WHO cancelled, not just that it happened. "Job was cancelled"
                    read identically whether the poster pulled it, this viewer
                    withdrew it, the listing expired, or support stepped in —
                    and the fee pill beneath only makes sense once you know it
                    was the poster. `jobs.cancelled_by` is already on the row
                    (`get_jobs_for_my_applications` returns SETOF jobs). */}
                <p className="text-ds-11 text-muted-foreground">
                  {isCancelled ? describeCancellation(job, userId) : "Not selected"}
                </p>
                {/* The fee is the assigned helper's: only the payee sees it. */}
                {isCancelled && job.helper_id === userId && (
                  <CancellationFeePill job={job} fallbackFeePercent={viewerFeePercent} />
                )}
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
          {/* While the inline editor (PendingApplicationSection) is open it
              owns Save/Cancel, so the outer Edit/Withdraw pair is hidden —
              two Cancel-shaped controls a few rows apart, one of which
              withdraws the whole application, is a trap. The Seen chip is
              information and stays; when there is none the band is dropped
              entirely rather than drawing an empty bordered strip. */}
          {!isMinimalCard && isPending && (editingMessageAppId !== app.id || viewedApp.poster_viewed_at) && (
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
              {editingMessageAppId !== app.id && (
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
                  onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "a job", jobId: job.id ?? null })}
                />
              </JobActionRow>
              )}
            </div>
          )}

          {/* === ACTION SECTIONS === */}

          {/* The full street address once this Helpr is offered or hired
              (VN-55). The server only sends it to someone allowed to see it. */}
          {(isOffered || isConfirmed || isActive || isDisputed) && (
            <JobAddressLine location={job.location} />
          )}

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
              /* The dispute dialog — the mid-job "Report a Problem" chip's
                 destination. Completed jobs no longer offer it (owner,
                 2026-09-14, VN-28: no report once done). */
              onOpenDispute={() => onDispute(job)}
              navigate={navigate}
            />
          )}

          {/* Disputed */}
          {isDisputed && (
            <DisputedSection
              app={app}
              job={job}
              userId={userId}
              initialTracking={initialTracking}
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

          {/* Completed - not yet reviewed: the proof photos and the review, as
              two chips on one row.

              The BAND itself is gated on having something to put in it. It used
              to be unconditional because the proof panel was unconditional —
              it printed "No photos were uploaded for this job" on a job with
              none. With the panel gone that would leave a bordered strip with
              nothing in it, which is the silent-band defect this card already
              has a fallback for further down. */}
          {isCompleted && !isFullyDone && (canLeaveReview || hasProof) && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
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
              {/* ONE row: the photos beside the review, rather than a proof
                  PANEL stacked above a one-chip row. `columns` is passed, not
                  counted, so an absent chip yields a deliberate one-up row
                  (JobActionRow). The Photos chip is gated on there BEING
                  photos — a chip is a tap, and an empty gallery is a dead
                  end — which is why this card no longer prints "No photos were
                  uploaded for this job" when a job has none. */}
              <JobActionRow columns={canLeaveReview && hasProof ? 2 : 1}>
                {hasProof ? (
                  <JobActionChip
                    icon={Image}
                    label="Photos"
                    ariaLabel="Photos — the before and after proof photos from this job"
                    tone="neutral"
                    onClick={() => setPhotosOpen(true)}
                  />
                ) : null}
                {!canLeaveReview ? null : helperReviewedJobIds.has(app.job_id) ? (
                  <JobActionChip
                    icon={CheckCircle2}
                    label="Reviewed"
                    ariaLabel="Already reviewed the person who posted this job"
                    tone="done"
                    disabled
                    onClick={() => {}}
                  />
                ) : (
                  <JobActionChip
                    icon={Star}
                    label="Leave a Review"
                    ariaLabel="Leave a review for the person who posted this job"
                    tone="edit"
                    onClick={() => onHelperReview(app.job_id, posterId!, app.posterName || "the person who posted this job")}
                  />
                )}
              </JobActionRow>
              <PhotoProofDialog
                open={photosOpen}
                onOpenChange={setPhotosOpen}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
              />
              {/* No dispute link on a completed job (owner, 2026-09-14,
                  VN-28: "they can't report a job once it's done") — this
                  replaced the issue-#113 7-day post-completion link. */}
            </div>
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
          {isFullyDone && isExpanded && hasProof && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              {/* The same Photos button as the completed-not-reviewed branch
                  above (owner item 10). Alone in its row here: on a job that is
                  finished AND reviewed there is nothing else left to do. The
                  band no longer renders at all when the job has no photos,
                  where it used to print an empty proof panel. */}
              <JobActionRow columns={1}>
                <JobActionChip
                  icon={Image}
                  label="Photos"
                  ariaLabel="Photos — the before and after proof photos from this job"
                  tone="neutral"
                  onClick={() => setPhotosOpen(true)}
                />
              </JobActionRow>
              <PhotoProofDialog
                open={photosOpen}
                onOpenChange={setPhotosOpen}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
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
    </JobCardPersonContext.Provider>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const AppliedJobCard = memo(AppliedJobCardInner);
