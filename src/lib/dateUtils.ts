/**
 * Parse a date string like "2026-04-12" into a local Date without timezone shifts.
 * Using `new Date("2026-04-12")` can shift the date by a day in negative-UTC timezones.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
