import { SeriesStrip } from "@/pages/posts/SeriesStrip";
import { SeriesDatesForJob, type SeriesCardJob } from "@/components/series/JobSeriesCardControls";
import { recurringVisitDates } from "@/lib/recurringSchedule";
import { seriesMoneySentence } from "@/lib/seriesMoneyCopy";
import { hasTaxableLine } from "@/lib/salesTax";

/**
 * The poster's series and schedule controls on a PostedJobCard, in card order:
 * the series strip (parents only; see SeriesStrip), who has each upcoming visit
 * date and offering the open ones (Q407 5), and a booked one-time job's
 * date/time change, which only a request the Helpr accepts can make (Q407 8).
 */
export function PostedJobSeriesControls({ job, userId }: { job: SeriesCardJob; userId: string | null | undefined }) {
  // A2-C36: a running series' parent card says the budget is per visit and when the later visits are charged,
  // in Review's words (seriesMoneyCopy). Not on an ended, cancelled or done series: no charge is ahead of it.
  const visits = !job.parent_job_id && job.recurrence_days?.length && job.recurrence_weeks && job.date_needed
    ? recurringVisitDates(job.date_needed, job.recurrence_days, job.recurrence_weeks).length
    : 0;
  const running = !job.series_ended_on && job.status !== "cancelled" && job.status !== "completed";
  const budget = Number(job.budget ?? 0);
  const seriesMoney = visits > 1 && running && budget > 0 ? seriesMoneySentence(budget, visits, hasTaxableLine(job.category)) : null;
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
      {seriesMoney && (
        <p data-series-money="" className="mx-4 mb-2 text-ds-11 text-muted-foreground">{seriesMoney}</p>
      )}
      <SeriesDatesForJob job={job} userId={userId} isPoster />
    </>
  );
}
