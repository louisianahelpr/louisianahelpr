/**
 * F284 (owner 11-11): when a poster may report their Helpr as a no-show.
 *
 * The SAME instant report_helper_no_show's GUARD 2 refuses before
 * (20261111202421_no_show_report_opens_30_minutes_after_start.sql):
 *   - a timed job: 30 minutes after its start ("You can report a no-show from 9:30 AM");
 *   - a job with no start time ("any time that day"): the end of its day, the next
 *     Central midnight (20261102100421, unchanged).
 * Unknown date: null (never offer a report on missing data).
 */
import { jobStartDateTime } from "@/lib/dateUtils";

export const NO_SHOW_WAIT_MINUTES = 30;

const JOB_TZ = "America/Chicago";

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The instant a no-show report opens, or null when the job's date is unknown. */
export function noShowOpensAt(dateNeeded: string | null | undefined, startTime?: string | null): Date | null {
  if (!dateNeeded || !/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) return null;
  if (!startTime) return jobStartDateTime(nextDay(dateNeeded), "00:00");
  const start = jobStartDateTime(dateNeeded, startTime);
  return start ? new Date(start.getTime() + NO_SHOW_WAIT_MINUTES * 60_000) : null;
}

/** True once a no-show may be reported (false on an unknown date). */
export function noShowReportOpen(dateNeeded: string | null | undefined, startTime?: string | null, now: Date = new Date()): boolean {
  const opens = noShowOpensAt(dateNeeded, startTime);
  return !!opens && now.getTime() >= opens.getTime();
}

/**
 * The sheet's line while the report is not open yet, in Louisiana time:
 * "You can report a no-show from 9:30 AM." (the same day) or
 * "You can report a no-show from Thu, Nov 12 at 9:30 AM." (another day).
 * A job with no start time: "You can report a no-show once the day is over."
 */
export function noShowOpensLine(dateNeeded: string | null | undefined, startTime?: string | null, now: Date = new Date()): string | null {
  const opens = noShowOpensAt(dateNeeded, startTime);
  if (!opens) return null;
  if (!startTime) return "This job is any time that day. You can report a no-show once the day is over.";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: JOB_TZ });
  const time = opens.toLocaleTimeString("en-US", { timeZone: JOB_TZ, hour: "numeric", minute: "2-digit" });
  if (day(opens) === day(now)) return `You can report a no-show from ${time}.`;
  const date = opens.toLocaleDateString("en-US", { timeZone: JOB_TZ, weekday: "short", month: "short", day: "numeric" });
  return `You can report a no-show from ${date} at ${time}.`;
}
