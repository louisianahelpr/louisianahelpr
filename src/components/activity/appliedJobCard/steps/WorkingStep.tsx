import { JobStepCard } from "@/components/activity/JobStepCard";
import { HelperPhotoAsk } from "./HelperPhotoAsk";
import { PayoutPrimary } from "./PayoutPrimary";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 3 — working.
 *
 * The exit chip is gone by rule (the card offers no "Can't Finish" once work is
 * underway), so the row is Message alone and the escape moves below it as a
 * quiet link. This is the one state where the escape exists, and it exists at
 * exactly the complement of the exit chip — removing a control must not remove
 * the path.
 *
 * The ask is the AFTER photo, not the before one: see HelperPhotoAsk.
 */
export function WorkingStep({
  app,
  job,
  tracker,
  messageChip,
  escape,
  abortedNotice,
  payout,
}: HelperStepProps & {
  payout: {
    hasPhotos: boolean;
    busy: boolean;
    tooEarly: boolean;
    minutesLeft: number;
    onComplete: () => void;
  };
}) {
  return (
    <JobStepCard
      side="helper"
      step="working"
      header={tracker}
      ask={<HelperPhotoAsk jobId={app.job_id} job={job} step="working" />}
      primary={<PayoutPrimary {...payout} />}
      actions={[messageChip]}
      escape={
        <>
          {escape}
          {abortedNotice}
        </>
      }
    />
  );
}
