import { SeriesStrip } from "@/pages/posts/SeriesStrip";
import { SeriesDatesForJob, type SeriesCardJob } from "@/components/series/JobSeriesCardControls";

/**
 * The poster's series and schedule controls on a PostedJobCard, in card order:
 * the series strip (parents only; see SeriesStrip), who has each upcoming visit
 * date and offering the open ones (Q407 5), and a booked one-time job's
 * date/time change, which only a request the Helpr accepts can make (Q407 8).
 */
export function PostedJobSeriesControls({ job, userId }: { job: SeriesCardJob; userId: string | null | undefined }) {
  return (
    <>
      {!job.parent_job_id && (
        <SeriesStrip
          jobId={job.id}
          recurrenceDays={job.recurrence_days}
          recurrenceWeeks={job.recurrence_weeks}
          dateNeeded={job.date_needed ?? null}
          seriesHelperCommitted={!!job.recurring_helper_id}
          seriesEndedOn={job.series_ended_on}
          canEnd={!!job.recurring_helper_id && job.status !== "cancelled"}
          jobTitle={job.title}
          userId={userId}
        />
      )}
      <SeriesDatesForJob job={job} userId={userId} isPoster />
    </>
  );
}
