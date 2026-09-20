import { JOB_TIMEZONE } from "../../../supabase/functions/_shared/cancellationFee";

/**
 * A `date_needed` fixture value — the job's calendar day in the PLATFORM's
 * zone, never the runner's and never UTC.
 *
 * WHY THIS EXISTS (2026-09-19). Eight specs across four files built their
 * job-day fixtures as `new Date(Date.now() - 24*3600e3).toISOString().slice(0, 10)`
 * and called the result YESTERDAY. `toISOString()` is UTC. On a machine in
 * US Pacific, at 19:42 local, UTC has already rolled over — so that "yesterday"
 * was 2026-09-19, which is TODAY in America/Chicago, and the app was right to
 * refuse to treat it as past:
 *
 *   - `completionStalled` (supabase/functions/_shared/stalledCompletion.ts)
 *     anchors on `scheduledEndMs = max(next-day midnight CENTRAL, start+hours)`,
 *     so a job is never "over" before its Central day is over. A Central-today
 *     job is not stalled — no disabled box, no "Why?" chip.
 *   - `helper_cancel_booking`'s gate and `hasJobStarted` resolve through
 *     `jobLocalStartMs`, also Central. A "start already passed" fixture dated
 *     UTC-tomorrow has a start that is still in the future, so Cancel Job is
 *     correctly still offered.
 *   - Activity bucketing compares `jobDateMs` against `todayMs()`
 *     (src/lib/jobDate.ts), which is America/Chicago midnight, so "today is
 *     live" never fired for a UTC-tomorrow fixture and those rows bucketed to
 *     Scheduled instead of Needs You.
 *
 * In every case the PRODUCT was right and the fixture's clock was wrong, and
 * the failure was time-of-day dependent: green all morning, red after 19:00
 * Pacific. `src/test/jobDayFixtureTimezone.test.ts` now fails CI on the whole
 * class.
 *
 * This resolves the day with `Intl` directly rather than through
 * `src/lib/jobDate.ts`, so a fixture never asserts against the same helper the
 * code under test reads.
 */
export function jobLocalDateISO(daysFromToday = 0, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, the exact shape of a Postgres `date`.
  // Offsetting the INSTANT and then resolving the zone (rather than doing
  // calendar arithmetic on the resolved string) keeps this to one line; the
  // two DST Sundays shift the instant by an hour, which cannot move the
  // calendar day for any offset used here.
  return new Intl.DateTimeFormat("en-CA", { timeZone: JOB_TIMEZONE }).format(
    new Date(now.getTime() + daysFromToday * 86_400_000),
  );
}
