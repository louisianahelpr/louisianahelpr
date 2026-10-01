// recurringSchedule — the AUTHORITY on which dates a recurring series runs.
//
// One definition, because two would be a money bug rather than a display bug:
// the Post-a-Task screen quotes "9 visits · $450 total" from this, and the
// charge cron bills the poster's saved card from this. If the two ever
// disagreed, the poster would be charged for a visit the app never showed them
// — or a helper would turn up on a date nobody paid for.
//
// Mirrored at src/lib/recurringSchedule.ts (the app bundle can't import Deno
// source), guarded by recurringSchedule.parity.test.ts — same arrangement as
// posterFees / helperFees / stripeFees / salesTax.

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getUTCDay()`. */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Hard ceiling on a series, mirrored by the jobs_recurrence_weeks_range CHECK. */
export const MAX_RECURRENCE_WEEKS = 52;

function parseYmd(ymd: string): Date {
  // Noon UTC, not midnight: a date-only string parsed at midnight and then
  // shifted by any timezone lands on the previous day, which would silently
  // move every visit in the series back one day.
  return new Date(`${ymd}T12:00:00Z`);
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Every date this series runs, in order.
 *
 * The series runs for `weeks` weeks counted FROM `startDate` (owner,
 * 2026-10-01): every date in [startDate, startDate + 7*weeks) whose weekday is
 * picked, and no other. That is always exactly weeks x |days| visits, and an
 * unpicked weekday is never one of them — a Mon+Thu series started on Fri
 * 2 Oct for 2 weeks is Oct 5, 8, 12, 15.
 *
 * The first visit is the first picked weekday on/after `startDate`, and the
 * post saves the first job ON that date (jobSubmitHelpers). Re-running this on
 * that saved `date_needed` gives the same dates (the last visit is < start +
 * 7*weeks either way), so the charge cron, the SQL series_visit_dates and every
 * reader that re-expands from `date_needed` agree with what the poster saw.
 *
 * @param startDate  the poster's chosen start (or the saved `date_needed`), "YYYY-MM-DD"
 * @param days       weekdays the series runs, 0=Sun..6=Sat (order irrelevant)
 * @param weeks      how many weeks from the start, 1..MAX_RECURRENCE_WEEKS
 */
export function recurringVisitDates(
  startDate: string,
  days: readonly number[],
  weeks: number,
): string[] {
  if (!startDate || !days?.length || !(weeks >= 1)) return [];
  const capped = Math.min(Math.floor(weeks), MAX_RECURRENCE_WEEKS);
  const wanted = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (wanted.size === 0) return [];

  const start = parseYmd(startDate);
  if (Number.isNaN(start.getTime())) return [];

  // N weeks FROM THE START DATE (owner, 2026-10-01): every day in
  // [start, start + 7N) whose weekday is picked. Not calendar weeks — those
  // dropped the picked days of the start's own week that fell before it, so a
  // Fri start on Mon+Thu for "2 weeks" gave 2 visits, not 4.
  const out: string[] = [];
  for (let i = 0; i < capped * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    if (wanted.has(d.getUTCDay())) out.push(toYmd(d));
  }
  return out;
}

/**
 * Visits after the first. The first visit IS the parent job — paid for at
 * checkout like any other job — so these are the ones the charge cron has to
 * bill the saved card for.
 */
export function upcomingVisitDates(
  startDate: string,
  days: readonly number[],
  weeks: number,
): string[] {
  return recurringVisitDates(startDate, days, weeks).slice(1);
}

/** How many visits the series runs in total, including the first. */
function visitCount(startDate: string, days: readonly number[], weeks: number): number {
  return recurringVisitDates(startDate, days, weeks).length;
}

/**
 * Total the poster commits to, in dollars — `budget` is PER VISIT.
 *
 * This is the number the Post-a-Task screen must show before they pay for the
 * first one. The old screen showed a total built from a guessed occurrence
 * count while charging for a single visit, which is how "roughly $600 total"
 * sat above a $50 charge.
 */
export function seriesTotalDollars(
  budgetPerVisit: number,
  startDate: string,
  days: readonly number[],
  weeks: number,
): number {
  if (!(budgetPerVisit > 0)) return 0;
  return budgetPerVisit * visitCount(startDate, days, weeks);
}
