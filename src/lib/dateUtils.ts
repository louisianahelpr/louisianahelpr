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
