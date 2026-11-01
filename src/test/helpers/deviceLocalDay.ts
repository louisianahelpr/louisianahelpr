/**
 * Fixture days on the DEVICE's calendar (the zone the test runs in), for code that reads the device's own day
 * (Declutter porch days and pickup cards: `new Date(y, m, d)` / `getDate()`), never Central and never UTC.
 * Job days resolve in Central: use jobLocalDateISO (./jobLocalDate) for those.
 *
 * WHY (2026-11-01, the fall-back Sunday, a 25-hour day). Fixtures built "tomorrow" as `now + 24 h`; at 00:30 CDT
 * that is 23:30 CST the SAME day, so buyingOrders' "for tomorrow" and declutterPickupDayCard's "booked today" went
 * red between 00:00 and 01:00. Likewise `now - 24 h` at 23:30 CST that night is 00:30 CDT the same day, not
 * yesterday. These add whole CALENDAR days, so DST can never move the day.
 */

/** The device-local calendar day `days` from today, as "YYYY-MM-DD". */
export function deviceLocalDateISO(days = 0, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The instant that is the same wall-clock time `days` calendar days from `now` on the device (an ISO string). */
export function deviceLocalShiftISO(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
