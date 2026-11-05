import { memo, useRef, useState } from "react";
import { BackoutBanner } from "@/components/job-card/BackoutBanner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useNavigate } from "react-router-dom";
import type { AppliedApp } from "../../components/job-card/activityConstants";
import { JobCardShell } from "../../components/job-card/JobCardShell";
import { MineJobFace, MineOpenMeta, mineFaceWhen } from "../../components/job-card/MineJobFace"; import { jobProgress } from "@/components/tracker/jobProgressState";
import { helperFaceAction, helperFaceNextStep } from "./appliedJobCard/helperFaceAction";
import { doneFloorStart, useDoneFloorMinutesLeft } from "@/components/job-card/useDoneFloor";
import { PersonTile } from "@/components/PersonTile";
import { JobCardPhotoStrip } from "../../components/job-card/JobCardPhotoStrip";
import { formatPriceFloor } from "@/lib/format";
import type { AppliedJobCardProps, ApplicationViewFields } from "./appliedJobCard/types";
import { useHighlightPulse } from "../../components/job-card/useHighlightPulse";
import { closedCardLabel, deriveAppliedJobCardState, describeCancellation, posterFirstName } from "./appliedJobCard/appliedJobCardHelpers";
import { CancellationFeePill } from "./appliedJobCard/CancellationFeePill";
import { PendingApplicationSection } from "./appliedJobCard/PendingApplicationSection";
import { OfferedActions } from "./appliedJobCard/OfferedActions";
import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";
import { ActiveJobSection } from "./appliedJobCard/ActiveJobSection";
import { DisputedSection } from "./appliedJobCard/DisputedSection";
import { CrewMemberSection } from "./appliedJobCard/CrewMemberSection";
import { OfferStepRail } from "./appliedJobCard/OfferStepRail";
import { HelperCollapsedStrip, helperCardLine } from "./appliedJobCard/HelperCollapsedStrip";
import { JobCardPersonContext, personSlotValue, useJobCardPersonSlot } from "../../components/job-card/jobCardPerson";
import { HelperMoneyNotices } from "./appliedJobCard/HelperMoneyNotices";
import { ClosedJobCard } from "./appliedJobCard/ClosedJobRow";
import { useUnsettledDisputeJobIds } from "@/hooks/useUnsettledDisputeJobIds";
import { reviewWindowOpen } from "@/lib/reviewWindow";
import { descriptionAddsToTitle, hasProofPhotos } from "@/lib/jobCardFacts";
import { JobRequestRows } from "@/components/series/JobSeriesCardControls";
import { useCardNotes } from "@/components/job-card/JobNotes";
import { useContinueDay } from "@/hooks/useContinueDays";
import { continueDayDoneNote } from "@/lib/continueDayWords";
import { RentalVisitHelprSlot } from "@/components/rentals/RentalVisitHelprSlot";
import { HelperJobMetaRow } from "./appliedJobCard/HelperJobMetaRow";
import { HelperPendingActions } from "./appliedJobCard/HelperPendingActions";
import { HelperDoneBands } from "./appliedJobCard/HelperDoneBands";

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
  // Viewer's tier rate (fallback when unstamped), and the one-time fee still due (Q753).
  const { profile: viewerProfile } = useCurrentUser();
  const firstPayoutFee = useFirstPayoutFeeDollars();
  // Q344: a decided dispute whose money has not moved is not "Paid out".
  const unsettledDisputeJobIds = useUnsettledDisputeJobIds();
  const viewerFeePercent = tierFeePercent(viewerProfile?.subscription_tier, viewerProfile?.subscription_expires_at ?? null);

  useHighlightPulse(highlight, cardRef);
  /* The person slot, opened BEFORE the `if (!job)` early return below (rules
     of hooks). The tile is built once the card knows the poster. */
  const { claim: personClaim, stepCarriesTile } = useJobCardPersonSlot();
  // The face's Mark it done is greyed for the same 30 minutes as the Working card's (useDoneFloor).
  const doneFloorMinutes = useDoneFloorMinutesLeft(doneFloorStart(app.job?.poster_confirmed_working_at, app.job?.helper_arrived_at));

  // `poster_viewed_at` isn't in the generated types yet (migration lag);
  // read it through this narrow view rather than `as any`.
  const viewedApp = app as AppliedApp & ApplicationViewFields;
  const job = app.job;
  // A day set to finish still ahead (Auditor 11, 11-01): the face never leads with Mark job complete then. Read
  // before the early return (hooks run on every render); only a hired Helpr's solo job under way can have one.
  const continueDay = useContinueDay(job?.id, !!job && job.status === "in_progress" && !job.is_group_job && job.helper_id === app.helper_id);
  const notes = useCardNotes(job, expandedJobIds.has(app.job_id), app.status === "accepted" && job?.status !== "cancelled" && job?.status !== "completed"); // Q1461: access only for a hired Helpr until the job ends
  if (!job) {
    // An application can outlive its job row's VISIBILITY: once the job closes to another helper, the jobs SELECT
    // policy hides it from a rejected applicant, so `app.job` comes back null. The bucket counts (activityFilters)
    // still tally this application under Done — a silent `null` here is what made the Done badge read 3 over a list
    // of 2 cards. Render the same minimal "Not selected" card, minus the job details we can no longer read.
    return <ClosedJobCard cardRef={cardRef} label={app.closed_job_label} status={closedCardLabel(app)} />;
  }
  const {
    status,
    isOffered,
    isConfirmed,
    isActive,
    isCrewLive,
    isDisputed,
    isCompleted,
    isCancelled,
    isPending,
    isFullyDone,
    isExpanded,
    payout,
    isMinimalCard,
    hasActionSection,
  } = deriveAppliedJobCardState(
    app,
    job,
    helperReviewedJobIds,
    expandedJobIds,
    viewerFeePercent,
    firstPayoutFee,
  );

  /** The poster, or null on a job whose poster deleted their account — deletion
   *  anonymises the job rather than removing it (20260901033011), so it stands
   *  with no owner and no address. Narrowed HERE, into a local, because reading
   *  `job.customer_id` again inside a callback re-widens it. */
  const posterId = job.customer_id;

  const hasProof = hasProofPhotos(job);
  /** `payout_pending` counts too, and a review needs a reviewee — both rules
   *  are unchanged, just named once now that this gate decides a chip in a
   *  shared row rather than a row of its own. See the notes at the call site. */
  const canLeaveReview =
    (job.payment_status === "released" || job.payment_status === "payout_pending") && !!posterId &&
    // DH-003: past the 30-day window only "Reviewed" is left to show.
    (helperReviewedJobIds.has(app.job_id) || reviewWindowOpen(job));

  const showDescription = !isMinimalCard && isExpanded && descriptionAddsToTitle(job);
  /** Whether the block between the meta row and the action row has ANY content.
   *  Every child of it is conditional — see the note at the block itself. */
  /* `app.posterName` no longer counts: the identity row sits in the meta block, so counting it would reserve an
     empty padded band (the defect STATUS_RENDERS_ACTIONS stops on the poster's card). */
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
  const showNotes = !isMinimalCard && notes !== null;
  /** Photos only inside the expanded card, above the buttons (owner 2026-10-06); pending draws its own. */
  const showBodyPhotos = !isMinimalCard && isExpanded && !isPending && (job.photos || []).length > 0;
  const hasCardBody = showDescription || bodyCarriesTile || showNotes || showBodyPhotos;

  // Location · date · time — built once, placed twice (HelperJobMetaRow says why).
  const metaRow = <HelperJobMetaRow job={job} isOffered={isOffered} isConfirmed={isConfirmed} isActive={isActive} isDisputed={isDisputed} isExpanded={isExpanded} isPending={isPending} />;

  // The states the server already hands the full address to (the meta row's own gate).
  const addressOnFace = !isMinimalCard && (isOffered || isConfirmed || isActive || isDisputed);
  const cardLine = helperCardLine(app, job, unsettledDisputeJobIds, initialTracking); // ONE line: the strip, the face's button (board 21), the 8-step bar
  const faceAction = helperFaceAction({
    isMinimalCard, isOffered, isPending, message: (isConfirmed || isActive || isDisputed) && !job.is_group_job && posterId ? { name: posterFirstName(app.posterName) || "them", onClick: () => navigate(`/messages?jobId=${job.id}&userId=${posterId}`) } : undefined,
    owesReview: isCompleted && !isFullyDone && canLeaveReview && !helperReviewedJobIds.has(app.job_id),
    posterId, review: (id) => onHelperReview(app.job_id, id, app.posterName || "the person who posted this job"), wait: cardLine.id, jobId: job.id, viewDispute: () => onViewDispute(job),
    manage: () => toggleExpandedJobId(app.job_id), open: () => { if (!isExpanded) toggleExpandedJobId(app.job_id); },
    step: (isConfirmed || isActive) && !isCrewLive && !job.is_group_job ? helperFaceNextStep(job, initialTracking, cardLine.id) : null,
    doneFloorMinutes,
    continueDayNote: continueDayDoneNote(continueDay),
  });

  // The one tracker state for the face (only the hired Helpr's): its bar and (A3-16) its next-step line read it.
  const posterFirst = (app.posterName ?? "").split(" ")[0] || null;
  const faceProgress = job.helper_id === userId ? jobProgress(job, { viewer: "helpr", otherFirst: posterFirst, card: { line: cardLine, face: faceAction } }) : null;
  return (
    /* The card publishes its own expand state to HelperTrackerPanel, which sits
       whichever JobStepCard this state mounts, through the shared person
       context (jobCardPerson.tsx). The provider wraps the WHOLE card so the
       body fallback below and the shell's claim are answering one question.
       The tile is already null while collapsed — see `posterTile` above. */
    <JobCardPersonContext.Provider value={personCtx}>
        <div ref={cardRef}>
        <JobCardShell
          /* THE FACE OPENS THE JOB PAGE (board 21, lead 2026-10-20); the
             card's live controls open in place from the face's one button. */
          expandable={false}
          expanded={isExpanded}
          onToggle={() => toggleExpandedJobId(app.job_id)}
        >
          <BackoutBanner job={job} />{/* the poster backed out: until Got It (Q1575) */}
          <MineJobFace
            jobId={job.id}
            title={job.title || "a job"}
            category={job.category}
            photo={job.photos?.[0] ?? null}
            // A hired Helpr's collapsed card keeps the full street address
            // (owner, 2026-09-19: "the address needs to show ... when they say
            // they are on their way"): the meta row, which carries date and
            // time too, stands in for the plain date line.
            when={addressOnFace || isExpanded ? "" : mineFaceWhen(job)}
            // A tap on the row opens the job, like the face (MineJobFace); holding the address opens the map.
            extra={addressOnFace ? metaRow : null}
            // FLOORED, matching JobPrice (owner, 2026-08-19): a take-home never
            // reads above the payout. What this Helpr takes home (board 21).
            // No "take-home" caption under it (owner 2026-10-25).
            money={`$${formatPriceFloor(payout)}`}
            status={
              !isMinimalCard && !isExpanded ? (
                <HelperCollapsedStrip variant="line" app={app} job={job} userId={userId} isCrewLive={isCrewLive} unsettledDisputeJobIds={unsettledDisputeJobIds} showStartClock={isConfirmed} hideStatus={isOffered} reviewed={isFullyDone} tracking={initialTracking} progress={faceProgress} otherFirst={posterFirst} />
              ) : null
            }
            action={isExpanded ? null : faceAction} onCollapse={isExpanded ? () => toggleExpandedJobId(app.job_id) : undefined}
            progress={!isExpanded ? faceProgress : null} /* the 8 steps on the card (owner, 2026-10-22) */
          />
          {isExpanded && <MineOpenMeta jobId={job.id} meta={addressOnFace ? null : metaRow} />}

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
          /* GROUPED WITH THE META, NOT WITH THE TRACKER — the same regrouping
             PostedJobCard takes, for the same owner note (2026-09-19: the
             description "should be under the location date and time on
             expansion. not with the live tracker box"), because both cards had
             the same proximity inversion:

               meta -> description    10px (title bar pb-2.5) + 10px (pt-2.5) = 20px
               description -> section  6px (pb-1.5) + the section's own padding

             `pt-1` closes the top to 14px. The BOTTOM only opens up when there
             is actually a description to detach — `pb-1.5` exists because the
             owner reported a dead band here ("remove gap under the location
             and above the buttons") on a card where every child was
             conditional and none of them rendered. That band is still
             collapsed to 6px when this block is carrying only the person tile
             or the not-selected line; it opens to 10px only when the
             description is in it, which is the case the owner is looking at
             and the one where the gap is doing work rather than reserving
             space for nothing. */
          <div
            data-job-card-body=""
            className={`px-4 pt-1 space-y-2 ${
              hasActionSection && !isMinimalCard ? (showDescription || showNotes ? "pb-2.5" : "pb-1.5") : "pb-3"
            }`}
          >
            {/* The description, once the card is open (the job page /jobs/:id has it too, board 21). */}
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
            {showNotes && notes}
            <RentalVisitHelprSlot jobId={app.job_id} jobStatus={job.status} show={!isMinimalCard && expandedJobIds.has(app.job_id) && app.status === "accepted" && !!job.helper_confirmed_at} />
            {showBodyPhotos && <JobCardPhotoStrip urls={job.photos || []} size="sm" stopPropagation />}

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

          <HelperPendingActions
            app={app} job={job} viewedApp={viewedApp} isMinimalCard={isMinimalCard} isPending={isPending} isExpanded={isExpanded}
            editingMessageAppId={editingMessageAppId} toggleExpandedJobId={toggleExpandedJobId} setEditingMessageAppId={setEditingMessageAppId}
            setEditMessageText={setEditMessageText} withdrawingAppId={withdrawingAppId} setWithdrawTarget={setWithdrawTarget}
          />

          {/* === ACTION SECTIONS === */}

          {/* Offered: accept/decline — celebratory framing since this
              is a poster reaching out directly. Gold-warm accent
              surfaces the "you were picked" moment without shouting. */}
          {isOffered && isExpanded && (<OfferStepRail job={job} />)}
          {isOffered && (
            <OfferedActions app={app} job={job} onHelperResponse={onHelperResponse} respondingHelperAppId={respondingHelperAppId} />
          )}

          {/* ── BEHIND THE EXPAND, AS ON MY POSTS (owner, 2026-09-19) ──────
             "jobs should open collapsed just like post does."

             The premise needed correcting before the fix: this card ALREADY
             defaulted to collapsed — `expandedJobIds` comes from
             `useCardExpansion(postedJobs, …)`, whose default-open set only
             ever holds POSTED job ids. What made a Jobs card LOOK open was
             that most of it was never behind the gate: these three sections
             each mount the full tracker AND the step card's action row, with
             no `isExpanded` in sight, so a "collapsed" card showed an
             eight-step rail, a map and a row of buttons.

             Gated now, which is what makes the collapsed card a summary. Two
             things deliberately stay outside the gate:
               · THE STREET ADDRESS — a Helpr heading out must not have to
                 expand a card to see where they are going (owner's explicit
                 carve-out; src/test/enRouteAddressVisible.test.tsx). It is no
                 longer a row of its own: it took the city's place in the meta
                 row above (owner, the same day: "this shouldnt show 2
                 addresses"), which is on the collapsed card either way;
               · OfferedActions — Accept/Decline on a direct offer is a
                 time-boxed decision, not a detail, and the owner did not ask
                 for it to move.

             What a collapsed card says about state is the STATUS STRIP at the
             bottom of this card — one sentence, naming whose move it is. It
             replaces the 16px-dot rail that stood there for a few hours
             (owner: "remove the dots"). */}
          {/* Q360: the money problem jobs.status cannot show, the poster's card's words (not for a passed-over applicant). */}
          {isExpanded && app.status !== "rejected" && <HelperMoneyNotices job={job} hired={app.status === "accepted"} amountLabel={null} only="problem" />}
          {/* Confirmed: show tracking + message */}
          {/* A date/time change, then a refund request: above the step, never below its row (Q1567). */}
          <JobRequestRows job={job} userId={userId} viewer="helper" expanded={isExpanded} otherName={app.posterName} feeFallbackPercent={viewerFeePercent} />
          {isConfirmed && isExpanded && (
            <ConfirmedSection
              app={app}
              job={job}
              userId={userId}
              initialTracking={initialTracking}
              navigate={navigate}
            />
          )}
          {/* In Progress / Revision */}
          {isActive && isExpanded && (
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
          {/* A crew member's live job (Q1382): their own roster row's steps. */}
          {isCrewLive && (
            <CrewMemberSection app={app} job={job} userId={userId} isExpanded={isExpanded} navigate={navigate} />
          )}
          {/* JOBS2-44: "Finish payout setup to get paid" (owner 10-25, payout_after_hire) sits under the step, never above it. */}
          {isExpanded && app.status !== "rejected" && <HelperMoneyNotices job={job} hired={app.status === "accepted"} amountLabel={`$${formatPriceFloor(payout)}`} only="setup" />}
          {/* Disputed */}
          {isDisputed && isExpanded && (
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

          <HelperDoneBands
            app={app} job={job} userId={userId} helperReviewedJobIds={helperReviewedJobIds} onHelperReview={onHelperReview}
            isCompleted={isCompleted} isFullyDone={isFullyDone} isExpanded={isExpanded} isMinimalCard={isMinimalCard} hasActionSection={hasActionSection}
            canLeaveReview={canLeaveReview} hasProof={hasProof} posterId={posterId} photosOpen={photosOpen} setPhotosOpen={setPhotosOpen}
          />
        </JobCardShell>
        </div>
    </JobCardPersonContext.Provider>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const AppliedJobCard = memo(AppliedJobCardInner);
