import { JobStepCard } from "@/components/activity/JobStepCard";
import { DirectionsButton } from "../DirectionsButton";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 1 — confirmed / on the way. The helper has not arrived yet.
 *
 * Nothing is being asked of them and there is nothing to complete, so the card
 * is exactly the tracker and the three peer controls. Directions is a peer of
 * Message here and disappears at arrival (they are already there), which is
 * what makes the next step a 2-up rather than a 3-up with a hole in it.
 *
 * The third control depends on the rail (owner, 2026-09-14, VN-18): before
 * "I'm On My Way" it is Cancel Job; once they are on the way the back-out is
 * gone and Report a Problem takes the slot. The container passes at most one.
 *
 * ONE ROW (owner, 2026-09-14, VN-21): the tracker's own next step ("I've
 * Arrived") is the row's primary — it portals in from JobTracking — and these
 * chips sit beside it. With four buttons at 375 the shell drops the chips to
 * icon-only; this step does not decide that.
 */
export function EnRouteStep({ job, tracker, messageChip, exitChip, reportChip, abortedNotice }: HelperStepProps) {
  const showDirections = !!job.location?.trim();
  return (
    <JobStepCard
      side="helper"
      step="en_route"
      header={tracker}
      actions={[
        showDirections ? <DirectionsButton key="directions" location={job.location} variant="chip" /> : null,
        messageChip,
        exitChip,
        reportChip,
      ]}
      escape={abortedNotice}
    />
  );
}
