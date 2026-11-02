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

/** The series state (ended, split), the cards' own non-fatal read; shared by the section and the page's row. */
export function useJobSeriesState(job: JobPageRow | null | undefined) {
  const isSeries = !!job && !job.parent_job_id && (job.recurrence_days?.length ?? 0) > 0;
  return useQuery({
    queryKey: [...queryKeys.jobs.all, "page", job?.id ?? "", "series-state"],
    queryFn: async () => (await fetchJobSeriesState([job!.id])).get(job!.id) ?? {},
    enabled: isSeries,
  });
}

/** The standing Helpr who is still hired on the series parent (same rule as HelperSeriesRow). */
export function canLeaveSeries(job: JobPageRow, userId: string, endedOn: string | null, isPoster: boolean): boolean {
  const isSeries = !job.parent_job_id && (job.recurrence_days?.length ?? 0) > 0;
  return isSeries && !isPoster && job.recurring_helper_id === userId && job.helper_id === userId && !endedOn && job.status !== "cancelled";
}

/**
 * A3-44: the row's extras with "Leave series" added, only when that makes More options hold 2+ items (owner 5:42 PM);
 * with no other extra it would be a lone item, so it stays the link beside the series line (`inMenu` false).
 */
export function withLeaveSeries<A extends { key: string }>(extras: A[], canLeave: boolean, leave: A): { extras: A[]; inMenu: boolean } {
  const inMenu = canLeave && extras.length >= 1;
  return { extras: inMenu ? [...extras, leave] : extras, inMenu };
}

/**
 * A3-44 (audit 11-01): the poster's job page shows the series too (`isPoster`), with which visits still need a Helpr.
 * A3-44 rest (B137): when the page's row already has another extra, "Leave series" is one more item in its More
 * options (`leaveInMenu`, owner 5:42 PM: a menu only with 2+ items) and its confirm opens from there (`leaveOpen`);
 * otherwise the link stays beside the summary.
 */
export function HiredSeriesSection({ job, userId, isPoster = false, leaveInMenu = false, leaveOpen, onLeaveOpenChange }: {
  job: JobPageRow; userId: string; isPoster?: boolean;
  leaveInMenu?: boolean; leaveOpen?: boolean; onLeaveOpenChange?: (open: boolean) => void;
}) {
  const isSeries = !job.parent_job_id && (job.recurrence_days?.length ?? 0) > 0;
  const state = useJobSeriesState(job);
  const line = isSeries ? seriesSummary(job) : null;
  if (!line) return null;
  const endedOn = state.data?.series_ended_on ?? null;
  const canLeave = canLeaveSeries(job, userId, endedOn, isPoster);
  const seriesJob = { ...job, status: job.status ?? "", series_ended_on: endedOn, series_split_ok: state.data?.series_split_ok ?? null };
  return (
    <div data-job-series="" className="space-y-2">
      <div className="flex items-center gap-1.5 text-ds-14 text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>{line}{endedOn && ` · ended ${formatJobDate(endedOn)}`}</span>
        {canLeave && (
          <span className="ml-auto shrink-0">
            <EndSeriesControl jobId={job.id} jobTitle={job.title} userId={userId} mode="leave" splitOk={!!state.data?.series_split_ok}
              trigger={!leaveInMenu} open={leaveInMenu ? !!leaveOpen : undefined} onOpenChange={onLeaveOpenChange} />
          </span>
        )}
      </div>
      <SeriesDatesForJob job={seriesJob} userId={userId} isPoster={isPoster} inset={false} nextStep />
    </div>
  );
}
