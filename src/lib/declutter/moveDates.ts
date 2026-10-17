/**
 * Move-out date helpers shared by moving-out mode (moves.ts) and the
 * moving-sale banner (movingSale.ts). Tiny and dependency-free on purpose:
 * a module both screens import lands in the signed-in shared chunk every
 * signed-in page loads (Q178 critical-path budget).
 */

/** Today's date in Louisiana as YYYY-MM-DD (the server's day). */
export function louisianaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "Saturday, Nov 14" for a YYYY-MM-DD date (read as a calendar day, no time zone shift). */
export function formatMoveDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
