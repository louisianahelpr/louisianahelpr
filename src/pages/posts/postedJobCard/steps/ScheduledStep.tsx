import { useState } from "react";
import { CalendarClock, MessageSquare, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobActionChip } from "../../../../components/job-card/JobActionRow";
import { PosterConfirmationPrimary } from "./PosterConfirmationPrimary";
import { JobConfirmation } from "@/components/JobConfirmation";
import { scheduleChangeAllowed } from "@/components/series/JobSeriesCardControls";
import { ScheduleChangeAskDialog, usePendingScheduleChange } from "@/components/schedule/ScheduleChangeControl";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 2 — a Helpr is booked, the job has not started.
 *
 * The mirror of the helper's `EnRouteStep`: nothing is being asked, nothing is
 * decidable yet, so the card is the row and only the row. The tracker for this
 * state is mounted by PostedJobCard itself, above these actions.
 *
 * NO SHARE once a Helpr is assigned (owner: "not sure this is necessary in some
 * places") — the link it copies leads to a job nobody else can take.
 *
 * CONFIRM ARRIVAL, ON THE ROW (owner, 2026-09-14, VN-21: every button on a
 * Posts card on one row). A booked job whose Helpr has tapped "I've Arrived"
 * before the status moved on used to draw a full-width "Confirm Arrival" of its
 * own in PostedJobCard, above the tracker. It is this step's primary now.
 *
 * AND IT NO LONGER DISAPPEARS (owner, 2026-09-19: "if it was clicked already it
 * should still show but with the box disabled"). The gate that used to decide
 * whether to render anything at all now decides which RUNG of one ladder this
 * card is on — see `posterConfirmationRung`. Enabled on exactly the same
 * condition as before (the Helpr confirmed the booking and arrived, the poster
 * has not vouched yet, the work is not already marked done); NO box before
 * that (owner decision Q1400, 2026-10-07: from accept until the Helpr marks
 * themselves arrived); a done-toned box after it. The label still differs
 * from InProgressStep's "Confirm They Arrived" — reported, not silently
 * changed, and it is the ladder that carries the difference now.
 */
export function ScheduledStep({
  job,
  userId,
  navigate,
  onCancel,
  onConfirmArrival,
  onConfirmWorking,
  confirmingArrivalJobId,
  confirmingWorkingJobId,
}: PosterStepCtx) {
  // The Helpr's answer-by clock is no longer drawn here: every clock on the
  // card is one CountdownRows above the tracker (owner, 2026-10-07, Q1399).
  //
  // "ASK FOR A NEW DATE OR TIME" IS A BUTTON ON THIS ROW, LEFT OF MESSAGE
  // (owner, 2026-10-07, Q1399), styled like Message; it opens the same form
  // the link below used to. A request already open keeps its state and its
  // answer in ScheduleChangeForJob below the row.
  const [askOpen, setAskOpen] = useState(false);
  const canAsk = scheduleChangeAllowed(job, userId, "poster");
  const { data: pendingChange } = usePendingScheduleChange(job.id, canAsk);
  const askedOfMe = !!pendingChange && pendingChange.responder_id === userId;
  const askedByMe = !!pendingChange && pendingChange.requested_by === userId;
  return (
    <JobStepCard
      side="poster"
      step="scheduled"
      /* In `notice` rather than `primary` because the box comes with a reason,
         and only a CHILD of the shell can portal into the row's note host. It
         claims the primary slot itself, which stands the `primary` prop down —
         the shell's existing one-primary rule, not a second one. */
      notice={
        <>
        <PosterConfirmationPrimary
          job={job}
          step="scheduled"
          confirmingArrivalJobId={confirmingArrivalJobId}
          confirmingWorkingJobId={confirmingWorkingJobId}
          onConfirmArrival={onConfirmArrival}
          onConfirmWorking={onConfirmWorking}
        />
        {/* "I'M STILL ON" IS THE ROW'S PRIMARY, RIGHT OF MORE, UNDER THE PROFILE
            (owner, 2026-10-08: "Buttons should be side by side always for post
            and jobs"). It was a "Still on for this one?" panel above the profile
            with More alone below. Same inline control as the Helpr's card;
            nothing until the Helpr has accepted the offer. */}
        {job.status === "accepted" && job.helper_confirmed_at && (
          <JobConfirmation
            variant="inline"
            hideNotYetOpen
            jobId={job.id}
            isOwner={true}
            isHelper={false}
            posterConfirmedAt={job.poster_confirmed_at}
            helperConfirmedAt={job.helper_confirmed_at}
            helperDayofConfirmedAt={job.helper_dayof_confirmed_at}
            dateNeeded={job.date_needed}
            startTime={job.start_time}
            jobStatus={job.status}
            helperOnTheWayAt={job.helper_on_the_way_at}
            helperArrivedAt={job.helper_arrived_at}
            onCantMakeIt={() => onCancel(job)}
          />
        )}
        </>
      }
      actions={[
        canAsk && !askedOfMe && (
          <JobActionChip
            key="reschedule"
            icon={CalendarClock}
            label={askedByMe ? "Ask for a different date or time" : "Ask for a new date or time"}
            tone="neutral"
            onClick={() => setAskOpen(true)}
          />
        ),
        <JobActionChip
          key="message"
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message Helpr"
          tone="message"
          onClick={() => navigate(job.helper_id ? `/messages?jobId=${job.id}&userId=${job.helper_id}` : "/messages")}
        />,
        <JobActionChip
          key="cancel"
          icon={XCircle}
          label="Cancel"
          ariaLabel="Cancel job"
          tone="danger"
          onClick={() => onCancel(job)}
        />,
      ]}
      dialogs={
        canAsk && (
          <ScheduleChangeAskDialog
            open={askOpen}
            onOpenChange={setAskOpen}
            jobId={job.id}
            jobTitle={job.title}
            userId={userId}
            dateNeeded={job.date_needed}
            startTime={job.start_time ?? null}
          />
        )
      }
    />
  );
}
