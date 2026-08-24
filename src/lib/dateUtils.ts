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
 * A job's scheduled start as a LOCAL Date, from the two columns that carry it:
 * `date_needed` (a Postgres `date`, wire format "YYYY-MM-DD") and `start_time`
 * (a `time without time zone`, wire format "HH:MM:SS").
 *
 * Both halves are local wall-clock values with no zone attached, so they must
 * be assembled through {@link parseLocalDate} and `setHours` — never
 * `new Date("2026-08-18T09:00:00")`-style string parsing, and never anything
 * that touches UTC. A 9:00 AM job is 9:00 AM where the user is standing.
 *
 * A flexible-schedule job has no `start_time`. It is treated as starting at
 * local midnight on its date, i.e. "the day has begun" is the strongest
 * statement the data supports.
 *
 * Returns null when there is no date at all.
 */
export function jobStartDateTime(
  dateNeeded: string | null | undefined,
  startTime?: string | null,
): Date | null {
  if (!dateNeeded) return null;
  const start = parseLocalDate(dateNeeded);
  if (Number.isNaN(start.getTime())) return null;
  if (startTime) {
    const [h, m] = startTime.split(":").map(Number);
    if (!Number.isNaN(h)) start.setHours(h, Number.isNaN(m) ? 0 : m, 0, 0);
  }
  return start;
}

/**
 * Has the job's scheduled start time come and gone?
 *
 * Owner's rule for the No-Show action: it is tied to the CLOCK, not to whether
 * the helper accepted — hidden while the job has not started yet, shown once
 * the start time has passed. A 9:00 AM job must not offer No-Show at 8:00 AM.
 *
 * Unknown date → false: never accuse anyone on the strength of missing data.
 */
export function hasJobStarted(
  dateNeeded: string | null | undefined,
  startTime?: string | null,
  now: Date = new Date(),
): boolean {
  const start = jobStartDateTime(dateNeeded, startTime);
  if (!start) return false;
  return now.getTime() >= start.getTime();
}
