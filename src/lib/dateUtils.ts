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
