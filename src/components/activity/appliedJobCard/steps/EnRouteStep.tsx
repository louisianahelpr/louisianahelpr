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
 */
export function EnRouteStep({ job, tracker, messageChip, exitChip, abortedNotice }: HelperStepProps) {
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
      ]}
      escape={abortedNotice}
    />
  );
}
