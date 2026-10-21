import { jobLocalMidnightMs, jobLocalStartMs } from "./cancellationFee.ts";

/**
 * ONE rule for the Helpr's day-before "Confirm you'll be at the job", enforced
 * and displayed (docs/JOB-LIFECYCLE.md, approved by the owner 2026-10-08).
 *
 * THE RULE.
 *   - The window OPENS at midnight the day before the job (`date_needed` is a
 *     bare DATE; midnight is resolved in America/Chicago, see below). Before
 *     that the Helpr's primary is the same button, greyed, saying when it turns
 *     on (contract step 4); from then on it is live (step 5).
 *   - The answer is owed until CONFIRM_DEADLINE_HOURS_BEFORE_START hours before
 *     the job's START (owner's answer 1: "if they don't, 2 hrs before it's
 *     reposted"). `sweep_confirm_reminders_and_repost` (migration
 *     20261008205730) reposts at that instant; the card prints it.
 *
 * Q1647: this file used to say the window closed 12 hours after it opened (noon
 * the day before) while the card and the SQL sweep said 2 hours before the
 * start, so `auto-expire-jobs` could reopen a job a day and a half before the
 * deadline the Helpr was shown. There is one deadline now, and
 * src/test/confirmDeadlineOneRule.test.ts fails if the SQL sweep's interval,
 * the card or the edge function stops agreeing with it.
 *
 * TIMEZONE. Deliberately NOT `toISOString().slice(0, 10)`. `date_needed` is a
 * bare `YYYY-MM-DD` that only means anything in Louisiana's zone. Both instants
 * resolve through the DST-correct, explicitly-zoned helpers the cancellation
 * ladder uses (`jobLocalMidnightMs`, and `jobLocalStartMs`, the twin of the SQL
 * `(date_needed + COALESCE(start_time, '00:00')) AT TIME ZONE
 * 'America/Chicago'`), so the cron (Deno, UTC), the database and the browser
 * compute the identical instant.
 */
export const CONFIRM_DEADLINE_HOURS_BEFORE_START = 2;
/** A description of the ordinary day only: the window opens at the previous
 *  CALENDAR day's midnight, which is 23 or 25 hours on the two DST days. */
export const CONFIRM_OPENS_HOURS_BEFORE = 24;

const HOUR_MS = 3_600_000;

/**
 * The calendar day before `dateNeeded`, as another bare `YYYY-MM-DD`.
 *
 * Done on the DATE, not by subtracting 24h from the job's midnight epoch —
 * because two days a year are not 24 hours long. Central's spring-forward day
 * is 23 hours, so `midnight(Mar 9) − 24h` is 23:00 on Mar 7, not midnight on
 * Mar 8; the fall-back day is 25 hours and lands on 01:00. Caught by
 * `confirmDeadline.boundary.test.ts`, which asserts the wall clock rather than
 * an offset. `Date.UTC` is safe here precisely because it is pure calendar
 * arithmetic with no zone in it — the zone is applied afterwards, once, by
 * `jobLocalMidnightMs`.
 */
function previousDay(dateNeeded: string): string {
  const [y, m, d] = dateNeeded.split("-").map(Number);
  const prev = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** Epoch ms at which the confirm control turns on — midnight the day before. */
export function confirmOpensMs(dateNeeded: string): number {
  return jobLocalMidnightMs(previousDay(dateNeeded));
}

/**
 * Epoch ms by which the Helpr must have confirmed: CONFIRM_DEADLINE_HOURS_BEFORE_START
 * before the job's start. A null `startTime` is midnight of the job day, as in
 * the SQL sweep's `COALESCE(start_time, '00:00')`.
 */
export function confirmDeadlineMs(dateNeeded: string, startTime: string | null): number {
  return jobLocalStartMs(dateNeeded, startTime) - CONFIRM_DEADLINE_HOURS_BEFORE_START * HOUR_MS;
}
