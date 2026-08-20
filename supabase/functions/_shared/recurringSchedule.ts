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
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
 * The series starts on `startDate` and runs for `weeks` calendar weeks. Week 1
 * is the week CONTAINING `startDate`, and dates before it are excluded — so a
 * Mon/Wed/Fri series first posted on the Wednesday runs Wed, Fri, then the full
 * Mon/Wed/Fri of the following weeks. Starting a "3 week" series mid-week
 * therefore yields fewer than 3x|days| visits, which is what a poster means by
 * "for the next three weeks".
 *
 * @param startDate  the first job's `date_needed`, "YYYY-MM-DD"
 * @param days       weekdays the series runs, 0=Sun..6=Sat (order irrelevant)
 * @param weeks      how many calendar weeks, 1..MAX_RECURRENCE_WEEKS
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

  // Walk from the Sunday that opens the start date's week so week boundaries
  // are calendar weeks, not "7 days from whenever you posted".
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const out: string[] = [];
  for (let week = 0; week < capped; week++) {
    for (let dow = 0; dow < 7; dow++) {
      if (!wanted.has(dow)) continue;
      const d = new Date(cursor);
      d.setUTCDate(cursor.getUTCDate() + week * 7 + dow);
      // Skip dates in the start week that fall before the job itself.
      if (d < start) continue;
      out.push(toYmd(d));
    }
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
export function visitCount(startDate: string, days: readonly number[], weeks: number): number {
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
