import { JobTracking } from "@/components/JobTracking";
import type { Job } from "../../../components/job-card/activityConstants";

/** The poster card's step rail (Posted · Offered · Accepted ...) on the Helpr's
 *  offer card too, read-only and behind the expand (owner, 2026-10-05).
 *  Guard: src/test/offerCardHierarchy.test.tsx. */
export function OfferStepRail({ job }: { job: Job }) {
  return (
    <div className="px-4 pt-1 pb-2" onClick={(e) => e.stopPropagation()} data-offer-tracker="">
      <JobTracking embedded includePostingSteps jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} posterConfirmedArrivalAt={job.poster_confirmed_arrival_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />
    </div>
  );
}
