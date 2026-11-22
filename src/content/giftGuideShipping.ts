/**
 * The gift guides' shipping banner (owner 2026-11-18), by the date in Louisiana (America/Chicago), whatever the
 * visitor's own zone:
 *   - Nov 1 through Dec 14: "Order by Dec 15 for Christmas delivery";
 *   - Dec 15 through Dec 20: "Last days for Christmas shipping: choose fast shipping";
 *   - Dec 21 through Dec 25: "Too late to ship? Print a free gift tag or coloring book today";
 *   - Dec 26 through Oct 31: no banner.
 * Holiday audit 1121: the early line came back every January (any month but December showed it). The last line named
 * gift cards, which left the guides on 11-20; owner 2026-11-21: "Just don't mention gift cards."
 * Guard: src/test/giftGuidesExtras.test.tsx.
 */
export const SHIP_LINES = {
  early: "Order by Dec 15 for Christmas delivery",
  late: "Last days for Christmas shipping: choose fast shipping",
  instant: "Too late to ship? Print a free gift tag or coloring book today",
} as const;

/** The month and day in America/Chicago at `now`. */
const chicagoMonthDay = (now: Date): { month: number; day: number } => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric" }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { month: num("month"), day: num("day") };
};

/** The banner's words at `now`, or null when it is hidden (Dec 26 through Oct 31). */
export function shippingLine(now: Date): string | null {
  const { month, day } = chicagoMonthDay(now);
  if (month === 11 || (month === 12 && day < 15)) return SHIP_LINES.early;
  if (month !== 12) return null;
  if (day <= 20) return SHIP_LINES.late;
  if (day <= 25) return SHIP_LINES.instant;
  return null;
}

/**
 * The landing's "Last-minute gifts" section (owner-approved 2026-11-18): Dec 15 through Dec 25 in Louisiana, whatever
 * the visitor's zone; hidden before and after. Its tiles are these guides, each only when it exists and holds picks
 * (an "e-gifts" guide joins on its own once one is published). Guard: src/test/giftGuideTrendingLastMinute.test.tsx.
 */
export const LAST_MINUTE = {
  title: "Last-minute gifts",
  note: "Arrives by Christmas",
  // Follow-up 1120: the memberships and advent calendars (every 0% gift card out, owner 11-20) are a section of Gifts by Budget.
  slugs: ["gifts-by-budget", "e-gifts"],
} as const;

/** Whether the "Last-minute gifts" section shows at `now` (Dec 15–25, America/Chicago). */
export function lastMinuteOn(now: Date): boolean {
  const { month, day } = chicagoMonthDay(now);
  return month === 12 && day >= 15 && day <= 25;
}
