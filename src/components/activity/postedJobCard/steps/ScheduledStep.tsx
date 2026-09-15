import { CheckCircle2, MessageSquare, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip, JobStepPrimaryButton } from "../../JobActionRow";
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
 * own in PostedJobCard, above the tracker. It is this step's primary now, with
 * the gate it had there: the Helpr confirmed and arrived, the poster has not
 * vouched yet, and the work is not already marked done (a job whose Helpr
 * has marked it done cannot still be asking whether they turned up). The label
 * still differs from InProgressStep's "Confirm They Arrived" — reported, not
 * silently changed.
 */
export function ScheduledStep({ job, navigate, onCancel, onConfirmArrival }: PosterStepCtx) {
  const showConfirmArrival =
    !!job.helper_confirmed_at &&
    !!job.helper_arrived_at &&
    !job.poster_confirmed_arrival_at &&
    !job.helper_completed_at;
  return (
    <JobStepCard
      side="poster"
      step="scheduled"
      primary={
        showConfirmArrival ? (
          <JobStepPrimaryButton
            icon={CheckCircle2}
            label="Confirm Arrival"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmArrival(job.id);
            }}
          />
        ) : null
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
