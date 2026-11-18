/**
 * The gift guides' shipping banner (owner 2026-11-18), by the date in Louisiana (America/Chicago), whatever the
 * visitor's own zone:
 *   - before Dec 15: "Order by Dec 15 for Christmas delivery";
 *   - Dec 15 through Dec 20: "Last days for Christmas shipping: choose fast shipping";
 *   - Dec 21 through Dec 25: "Last-minute? Gift cards and digital gifts arrive instantly";
 *   - after Dec 25: no banner.
 * Guard: src/test/giftGuidesExtras.test.tsx.
 */
export const SHIP_LINES = {
  early: "Order by Dec 15 for Christmas delivery",
  late: "Last days for Christmas shipping: choose fast shipping",
  instant: "Last-minute? Gift cards and digital gifts arrive instantly",
} as const;

/** The month and day in America/Chicago at `now`. */
export const chicagoMonthDay = (now: Date): { month: number; day: number } => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric" }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { month: num("month"), day: num("day") };
};

/** The banner's words at `now`, or null when it is hidden (Dec 26 to Dec 31). */
export function shippingLine(now: Date): string | null {
  const { month, day } = chicagoMonthDay(now);
  if (month !== 12 || day < 15) return SHIP_LINES.early;
  if (day <= 20) return SHIP_LINES.late;
  if (day <= 25) return SHIP_LINES.instant;
  return null;
}
