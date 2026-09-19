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
      notice={<PayoutUnlockNote hasPhotos={payout.hasPhotos} tooEarly={payout.tooEarly} minutesLeft={payout.minutesLeft} />}
      primary={<PayoutPrimary {...payout} />}
      /* THE PHOTO CAPTURE IS A CHIP IN THE ROW, not a panel above it
         (owner, 2026-09-19: "before and after buttons should also be on the
         same lines as the other buttons"). It renders nothing once the
         photo this step asks for exists, and nothing at all on a job the
         poster marked as needing no photos — so the row is 3-up or 4-up,
         never a hole. It LEADS the chips: it is the thing being asked for. */
      actions={[<HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="working" />, messageChip, reportChip]}
      escape={abortedNotice}
    />
  );
}
