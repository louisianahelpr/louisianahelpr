import { MessageSquare, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip } from "../../JobActionRow";
import { PosterConfirmationPrimary } from "./PosterConfirmationPrimary";
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
 * has not vouched yet, the work is not already marked done); disabled with an
 * honest reason before that; a done-toned box after it. The label still differs
 * from InProgressStep's "Confirm They Arrived" — reported, not silently
 * changed, and it is the ladder that carries the difference now.
 */
export function ScheduledStep({
  job,
  navigate,
  onCancel,
  onConfirmArrival,
  onConfirmWorking,
  confirmingArrivalJobId,
  confirmingWorkingJobId,
}: PosterStepCtx) {
  return (
    <JobStepCard
      side="poster"
      step="scheduled"
      /* In `notice` rather than `primary` because the box comes with a reason,
         and only a CHILD of the shell can portal into the row's note host. It
         claims the primary slot itself, which stands the `primary` prop down —
         the shell's existing one-primary rule, not a second one. */
      notice={
        <PosterConfirmationPrimary
          job={job}
          step="scheduled"
          confirmingArrivalJobId={confirmingArrivalJobId}
          confirmingWorkingJobId={confirmingWorkingJobId}
          onConfirmArrival={onConfirmArrival}
          onConfirmWorking={onConfirmWorking}
        />
      }
      actions={[
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
    />
  );
}
