import { jobLocalStartMs } from "../../supabase/functions/_shared/cancellationFee";

/**
 * Parse a date string like "2026-04-12" into a local Date without timezone shifts.
 * Using `new Date("2026-04-12")` can shift the date by a day in negative-UTC timezones.
 *
 * Also tolerates a leading ISO timestamp ("2026-04-12T05:00:00Z") by stripping
 * everything after the date — PostgREST emits DATE columns as "YYYY-MM-DD",
 * but callers occasionally pass full timestamps through, and silently
 * returning an Invalid Date there causes downstream `.toISOString()` calls
 * to throw RangeError (which crashed the JobDetailDialog in the e2e suite).
 */
export function parseLocalDate(dateStr: string): Date {
  // Strip any time component first — "2026-04-12T05:00:00Z" → "2026-04-12".
  // Splitting on "-" with the time still attached would yield NaN on the
  // day field (Number("12T05:00:00Z") === NaN).
  const dateOnly = dateStr.split("T")[0] ?? dateStr;
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Render a job's `date_needed` ("YYYY-MM-DD") the canonical way every job
 * surface should: weekday-inclusive ("Mon, Jun 22"). Card and detail views
 * previously disagreed (card showed the weekday, detail dropped it); route
 * all job-date rendering through this so the same job reads identically.
 */
export function formatJobDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Render "how much longer" the canonical way every countdown should:
 * "5 days left" · "22 hours left" · "9 minutes left".
 *
 * Use this for ANY remaining-time chip — never
 * `formatDistanceToNow(d, { addSuffix: false }) + " left"`. date-fns'
 * distance formatter is built for prose ("posted about 3 hours ago") and is
 * deliberately fuzzy, so that expression produced a different SHAPE of
 * sentence depending only on the remainder: the same expiry chip read
 * "5 days left" on one card and "about 22 hours left" on the next, with
 * "almost 2 days left" and "less than a minute left" also in the mix.
 * Browse, My Posts and My Jobs all render this chip, so the inconsistency
 * was visible side by side.
 *
 * Units are FLOORED, never rounded up: a deadline must never advertise more
 * time than actually remains (23h59m reads "23 hours left", not "1 day").
 * The caller owns the expired case — both card families already print their
 * own "Expired" copy — so a non-positive remainder returns "Expired" only as
 * a defensive fallback.
 */
export function formatTimeLeft(expiry: Date, now: Date = new Date()): string {
  const totalMinutes = Math.floor((expiry.getTime() - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return "Expired";

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} left`;

  const days = Math.floor(totalMinutes / 1440);
  if (days >= 1) return plural(days, "day");

  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return plural(hours, "hour");

  return plural(totalMinutes, "minute");
}

/**
 * Today's date as a local "YYYY-MM-DD" string.
 *
 * Use this anywhere you compare against a DATE column or set a date
 * input's `min` — NOT `new Date().toISOString().slice(0, 10)`, which is
 * UTC. In any negative-UTC timezone (e.g. US Central) the UTC date rolls
 * to "tomorrow" after ~6pm local, so a UTC "today" highlights the wrong
 * calendar cell and makes date pickers reject the current day.
 */
export function todayLocalISO(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A job's scheduled start as a real INSTANT, from the two columns that carry
 * it: `date_needed` (a Postgres `date`, "YYYY-MM-DD") and `start_time` (a
 * `time without time zone`, "HH:MM:SS").
 *
 * Neither column carries a zone, so the pair is a WALL CLOCK — and the zone it
 * is a wall clock in is the job's, not the reader's. This is a Louisiana
 * marketplace: a 6:30 PM job is 6:30 PM in Louisiana for everybody looking at
 * it, the same doctrine `jobDate.ts` already applies to which DAY a job is on.
 *
 * This doc used to say the opposite — "A 9:00 AM job is 9:00 AM where the user
 * is standing" — and the code implemented it, assembling the instant with
 * `parseLocalDate` + `setHours`, i.e. in the RUNTIME's zone. A 2026-09-06
 * end-to-end review viewing from Pacific found a 6:30 PM Central job counting
 * down as if it started at 6:30 PM Pacific: two hours late, and with it the
 * two-hour "Actions unlock at" gate on the tracker rail. The helper is told the
 * wrong time and the buttons open at the wrong moment.
 *
 * `jobLocalStartMs` is the same resolver the cancellation-fee ladder uses, and
 * it takes its offset AT the start instant, so a job on a DST boundary is not
 * an hour out.
 *
 * `timeZone` is injectable so a test can assert two different zones resolve to
 * two different correct instants. Without that the old test could not fail:
 * it built "now" with `new Date(2026, 7, 18, 9, 0)` — the runtime's zone on
 * both sides of the comparison, so the offset cancelled and the assertion held
 * in every timezone including the wrong ones.
 *
 * A flexible-schedule job has no `start_time` and is treated as starting at
 * midnight in the job's zone — "the day has begun" is the strongest statement
 * the data supports.
 *
 * Returns null when there is no date at all, or when it is not a bare
 * `YYYY-MM-DD`. An ISO timestamp must not slip through by prefix: its first ten
 * characters are the UTC day, which is the very confusion this resolves.
 */
export function jobStartDateTime(
  dateNeeded: string | null | undefined,
  startTime?: string | null,
  timeZone?: string,
): Date | null {
  if (!dateNeeded) return null;
  // Anchored at BOTH ends, matching `jobDate.ts` — an ISO timestamp must not
  // slip through by prefix, because its first ten characters are the UTC day
  // and the UTC day is not the job's day. `jobs.date_needed` is a NOT NULL
  // Postgres `date`, so PostgREST always sends a bare "YYYY-MM-DD"; anything
  // else is a caller passing the wrong column.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) return null;
  const ms = jobLocalStartMs(dateNeeded, startTime ?? null, timeZone);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Has the job's scheduled start time come and gone?
 *
 * Owner's rule for the No-Show action: it is tied to the CLOCK, not to whether
 * the helper accepted — hidden while the job has not started yet, shown once
 * the start time has passed. A 9:00 AM job must not offer No-Show at 8:00 AM.
 *
 * Unknown date → false: never accuse anyone on the strength of missing data.
 *
 * Both sides are absolute instants: `now` is one, and the start is resolved in
 * the JOB's zone by `jobStartDateTime`. Comparing them is therefore zone-free.
 */
export function hasJobStarted(
  dateNeeded: string | null | undefined,
  startTime?: string | null,
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  const start = jobStartDateTime(dateNeeded, startTime, timeZone);
  if (!start) return false;
  return now.getTime() >= start.getTime();
}
