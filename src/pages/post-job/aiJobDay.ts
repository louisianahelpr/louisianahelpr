/**
 * A2-C25 (app audit 2026-10-28): the AI job builder's day ("saturday",
 * "tomorrow"...) as the post-job form's date, a Louisiana calendar day
 * ("YYYY-MM-DD", src/lib/jobDate.ts). A weekday is its next date, today
 * included when today is that weekday (the form's own past-time check
 * still says if the hour has gone).
 */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function aiDayToDate(day: string | undefined, todayYmd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayYmd);
  if (!day || !m) return null;
  const today = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const ahead = day === "today" ? 0 : day === "tomorrow" ? 1 : WEEKDAYS.includes(day) ? (WEEKDAYS.indexOf(day) - today.getUTCDay() + 7) % 7 : -1;
  if (ahead < 0) return null;
  return new Date(today.getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
}

/** The builder's start time, only as the form stores it ("HH:MM", 24 h). */
export function aiStartTime(t: string | undefined): string | null {
  return t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
}
