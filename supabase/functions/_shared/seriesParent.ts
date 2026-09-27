/**
 * A LIVE recurring-series parent: the row that carries recurrence_days and
 * holds the series together (visit one IS this row). It stays `open` while
 * its dates are picked by Helprs (split days, owner decision Q407 (4)/(5)), so
 * its own date_needed passing says nothing about the series: an expiry sweep
 * that cancelled it would end every later visit (money review MED-3,
 * 2026-09-27). It is live until end_recurring_series stamps series_ended_on
 * or its recurrence_end_date has passed.
 *
 * Reads series_ended_on / recurrence_end_date only if the row carries them, so
 * a caller selecting `*` works before and after the migration that adds
 * series_ended_on (deploy order). Zero imports on purpose.
 */
export interface SeriesParentRow {
  parent_job_id?: string | null;
  recurrence_days?: unknown[] | null;
  series_ended_on?: string | null;
  recurrence_end_date?: string | null;
}

export function isLiveSeriesParent(job: SeriesParentRow, todayIso: string): boolean {
  if (job.parent_job_id) return false;
  if (!Array.isArray(job.recurrence_days) || job.recurrence_days.length === 0) return false;
  if (job.series_ended_on) return false;
  if (job.recurrence_end_date && job.recurrence_end_date < todayIso) return false;
  return true;
}
