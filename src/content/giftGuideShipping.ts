/**
 * The gift guides' Christmas dates, by the date in Louisiana (America/Chicago), whatever the visitor's own zone.
 * The "Order by Dec 15 for Christmas delivery" shipping pill that lived here came off every guides page (owner
 * 2026-11-24 ~8:30 PM: "Remove by Dec 15 everywhere"); guard: src/test/giftGuideNoShipPill1124.test.tsx.
 */

/** The month and day in America/Chicago at `now`. */
const chicagoMonthDay = (now: Date): { month: number; day: number } => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric" }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { month: num("month"), day: num("day") };
};

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
