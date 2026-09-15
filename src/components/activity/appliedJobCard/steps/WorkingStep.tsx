import { JobStepCard } from "@/components/activity/JobStepCard";
import { HelperPhotoAsk } from "./HelperPhotoAsk";
import { PayoutPrimary, PayoutUnlockNote } from "./PayoutPrimary";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 3 — working.
 *
 * There is no back-out chip by rule (Cancel Job exists only before "I'm On My
 * Way" — owner, 2026-09-14, VN-18), so the row is Message plus Report a
 * Problem, side by side (owner, 2026-09-14, VN-19 — reverses the earlier
 * "quiet link below the row"). Report a Problem exists at exactly the
 * complement of Cancel Job — removing a control must not remove the path.
 *
 * The ask is the AFTER photo, not the before one: see HelperPhotoAsk.
 *
 * ONE ROW (owner, 2026-09-14, VN-21): the photo ask stays above; the row is
 * the tracker's "Mark Job Complete" (the primary) with Message and Report a
 * Problem beside it. PayoutPrimary — the same label — renders only when the
 * tracker offers no CTA, so the card never shows the pair twice.
 */
export function WorkingStep({
  app,
  job,
  tracker,
  messageChip,
  reportChip,
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
      notice={<PayoutUnlockNote hasPhotos={payout.hasPhotos} tooEarly={payout.tooEarly} minutesLeft={payout.minutesLeft} />}
      primary={<PayoutPrimary {...payout} />}
      actions={[messageChip, reportChip]}
      escape={abortedNotice}
    />
  );
}
