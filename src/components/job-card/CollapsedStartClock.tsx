import { JobCountdown } from "@/components/job-card/JobCountdown";

/** "Job starts in" on a COLLAPSED card too (owner, 2026-10-05): the same pill
 *  the expanded body draws, on the poster's and the Helpr's card alike.
 *  Guard: src/test/offerCardHierarchy.test.tsx. */
export function CollapsedStartClock({ job }: { job: { date_needed: string | null; start_time: string | null } }) {
  return (
    <div className="px-4 pb-2" data-collapsed-start-clock="">
      <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
    </div>
  );
}
