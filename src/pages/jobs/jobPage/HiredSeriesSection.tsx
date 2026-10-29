/**
 * A2-C42 (audit 2026-10-29): the hired Helpr's /jobs/:id said one date for a
 * Repeats job. Their Activity card already carried the series (HelperSeriesRow);
 * the job's own page now says it too: "Weekly · 4 visits until Nov 21", the
 * standing Helpr's Leave series, and the visit dates they hold or can pick.
 *
 * The series state (series_ended_on, series_split_ok) rides on its own
 * non-fatal read, as on the cards (fetchJobSeriesState, JOB_SERIES_STATE_COLUMNS).
 */
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { EndSeriesControl } from "@/components/series/EndSeriesControl";
import { SeriesDatesForJob } from "@/components/series/JobSeriesCardControls";
import { formatJobDate } from "@/lib/dateUtils";
import { seriesSummary } from "@/lib/format";
import { fetchJobSeriesState } from "@/lib/jobSeriesState";
import { queryKeys } from "@/lib/queryKeys";
import type { JobPageRow } from "./useJobPage";

export function HiredSeriesSection({ job, userId }: { job: JobPageRow; userId: string }) {
  const isSeries = !job.parent_job_id && (job.recurrence_days?.length ?? 0) > 0;
  const state = useQuery({
    queryKey: [...queryKeys.jobs.all, "page", job.id, "series-state"],
    queryFn: async () => (await fetchJobSeriesState([job.id])).get(job.id) ?? {},
    enabled: isSeries,
  });
  const line = isSeries ? seriesSummary(job) : null;
  if (!line) return null;
  const endedOn = state.data?.series_ended_on ?? null;
  // The standing Helpr who is still hired on the series parent (same rule as HelperSeriesRow).
  const canLeave = job.recurring_helper_id === userId && job.helper_id === userId && !endedOn && job.status !== "cancelled";
  const seriesJob = { ...job, status: job.status ?? "", series_ended_on: endedOn, series_split_ok: state.data?.series_split_ok ?? null };
  return (
    <div data-job-series="" className="space-y-2">
      <div className="flex items-center gap-1.5 text-ds-14 text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>{line}{endedOn && ` · ended ${formatJobDate(endedOn)}`}</span>
        {canLeave && (
          <span className="ml-auto shrink-0">
            <EndSeriesControl jobId={job.id} jobTitle={job.title} userId={userId} mode="leave" />
          </span>
        )}
      </div>
      <SeriesDatesForJob job={seriesJob} userId={userId} isPoster={false} inset={false} />
    </div>
  );
}
