import { deriveCurrentStatusIdx, STATUS_IDX } from "@/components/JobTracking";
import type { Job } from "../../../../components/job-card/activityConstants";

/**
 * How far along the Helpr's card is: ONE derivation for the expanded card
 * (ActiveJobSection picks its step component from it) and the collapsed line
 * (HelperCollapsedStrip passes `workUnderway` to helperStatusLine).
 *
 * They disagreed (lane B, 2026-10-12): on the on-site step with the before
 * photo taken, the expanded primary was the tracker's "Start Working", while
 * the collapsed line, which read only the jobs row, said "Finish and mark it
 * done". Whether work is underway lives on the `job_tracking` row, which the
 * line never saw. Guard: src/test/collapsedLineNamesThePhotoPrimary.test.tsx.
 *
 * `trackingStatus`: the latest `job_tracking.status` the card holds, or null.
 */
export function helperProgress(job: Job, trackingStatus: string | null | undefined) {
  const trackerIdx = deriveCurrentStatusIdx({
    trackingStatus: trackingStatus ?? null,
    jobStatus: job.status,
    helperConfirmedAt: job.helper_confirmed_at,
    helperDayofConfirmedAt: job.helper_dayof_confirmed_at,
    jobDateNeeded: job.date_needed,
    posterConfirmedAt: job.poster_confirmed_at,
    helperOnTheWayAt: job.helper_on_the_way_at,
    helperArrivedAt: job.helper_arrived_at,
    helperArrivalVerifiedAt: job.helper_arrival_verified_at,
    posterConfirmedArrivalAt: job.poster_confirmed_arrival_at,
    helperArrivalNearMissAt: (job as { helper_arrival_near_miss_at?: string | null }).helper_arrival_near_miss_at,
    helperCompletedAt: job.helper_completed_at,
    posterCompletedAt: job.poster_completed_at,
  });
  return {
    trackerIdx,
    workUnderway: trackerIdx >= STATUS_IDX.working,
    hasArrived: trackerIdx >= STATUS_IDX.arrived,
    onTheWay: trackerIdx >= STATUS_IDX.on_the_way,
    hasConfirmed: trackerIdx >= STATUS_IDX.confirmed,
  };
}
