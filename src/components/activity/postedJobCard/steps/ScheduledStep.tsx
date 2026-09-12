import { MessageSquare, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip } from "../../JobActionRow";
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
 */
export function ScheduledStep({ job, navigate, onCancel }: PosterStepCtx) {
  return (
    <JobStepCard
      side="poster"
      step="scheduled"
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
