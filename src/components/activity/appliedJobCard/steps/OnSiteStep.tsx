import { JobStepCard } from "@/components/activity/JobStepCard";
import { HelperPhotoAsk } from "./HelperPhotoAsk";
import { PayoutPrimary, PayoutUnlockNote } from "./PayoutPrimary";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 2 — arrived, work not started.
 *
 * The step's ask is the Before photo, and it is the only ask on the card. The
 * owner's states 2 and 3 were the same layout with a long amber warning
 * paragraph bolted onto one of them; that warning belongs to the tracker's own
 * arrival step (it is the reason the tracker's Done control is refused), so it
 * is not duplicated here.
 *
 * Directions is gone — they are standing at the address. So is Cancel Job
 * (owner, 2026-09-14, VN-18: no back-out once on the way or arrived); Report a
 * Problem sits beside Message instead.
 *
 * ONE ROW (owner, 2026-09-14, VN-21): the tracker's "Start Working" is the
 * row's primary, Message and Report a Problem sit beside it. PayoutPrimary is
 * only the fallback for a card whose tracker offers no next step.
 */
export function OnSiteStep({
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
      step="on_site"
      header={tracker}
      ask={<HelperPhotoAsk jobId={app.job_id} job={job} step="on_site" />}
      notice={<PayoutUnlockNote hasPhotos={payout.hasPhotos} tooEarly={payout.tooEarly} minutesLeft={payout.minutesLeft} />}
      primary={<PayoutPrimary {...payout} />}
      actions={[messageChip, reportChip]}
      escape={abortedNotice}
    />
  );
}
