import { JOB_TIMEZONE } from "./cancellationFee.ts";

/**
 * Today's calendar date in the PLATFORM's zone (America/Chicago), as a bare
 * `YYYY-MM-DD` — the shape `jobs.date_needed` and `recurring_visit_payments.visit_date`
 * (both Postgres `date`) are stored in.
 *
 * WHY THIS EXISTS (Q1203). Two edge functions compared a visit's Louisiana date
 * with `new Date().toISOString().slice(0, 10)`, which is the UTC date. From
 * 19:00 CDT (18:00 CST) the UTC date is already tomorrow's, so a payment window
 * closed a day early. A `date` column has no zone; the only day it can mean is
 * the one on a Louisiana calendar. Every "is this job or visit date today /
 * past / due" check in `supabase/functions` goes through here, and
 * `src/test/louisianaDateClass.test.ts` fails CI on a UTC date string
 * compared against one.
 *
 * `en-CA` is used only because it formats as `YYYY-MM-DD`.
 */
export function louisianaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JOB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
