/**
 * Q2408 "Any time this week": a job's day can be a WINDOW. jobs.date_needed is its first day and
 * jobs.date_window_end its last (at most 6 days later; NULL = a one-day job). Every place that prints a job's day
 * uses jobDayLabel so a window never shows as one specific day.
 */
import { formatJobDate } from "@/lib/dateUtils";

/** The longest window: the first day plus 6 more (7 days in all). Mirrors jobs_date_window_end_in_a_week. */
export const DATE_WINDOW_EXTRA_DAYS = 6;

/** "2026-11-04" + 6 -> "2026-11-10" (calendar days, no time zone shift). */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The window's last day for a job posted as "Any time this week" starting on `firstDay`. */
export function weekWindowEnd(firstDay: string): string {
  return addDaysYmd(firstDay, DATE_WINDOW_EXTRA_DAYS);
}

/** True when the job is a window (a valid end after its first day). */
type JobDays = { date_needed?: string | null; date_window_end?: string | null } | null | undefined;

export function hasDateWindow(job: JobDays): boolean {
  return !!job?.date_needed && !!job.date_window_end && job.date_window_end > job.date_needed;
}

const monthDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * The job's day as people read it: "Wed, Nov 4" for one day, "Any day Nov 4-10" for a window
 * ("Any day Oct 30-Nov 5" across a month).
 */
export function jobDayLabel(job: JobDays): string {
  if (!job?.date_needed) return "";
  if (!hasDateWindow(job)) return formatJobDate(job.date_needed);
  const a = monthDay(job.date_needed);
  const b = monthDay(job.date_window_end!);
  const sameMonth = a.split(" ")[0] === b.split(" ")[0];
  return `Any day ${a}-${sameMonth ? b.split(" ")[1] : b}`;
}

/** The last day the job can still be done (the window's end, else its one day). Expiry and "date passed" read this. */
export function jobLastDay(job: JobDays): string | null {
  if (!job?.date_needed) return null;
  return hasDateWindow(job) ? job.date_window_end! : job.date_needed;
}
