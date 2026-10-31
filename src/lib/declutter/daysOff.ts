/**
 * NIGHT-SET-Declutterse-5 (settings audit 10-30 #5): "I can deliver" took a day off in the past (2020-01-01 showed as
 * "Wed, Jan 1") and a day past the server's year (declutter_set_delivery_schedule refuses more than today + 366, so
 * the whole Save failed). Days off are local Louisiana dates from today up to a year out, and a day not in this year
 * shows its year. Pure, so the rule is tested apart from the screen.
 */
const TZ = "America/Chicago";
const KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's Louisiana date as YYYY-MM-DD, and the last day off the server takes (a year out). */
export function dayOffBounds(now: Date = new Date()): { min: string; max: string } {
  const min = KEY.format(now);
  const last = new Date(`${min}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 365);
  return { min, max: last.toISOString().slice(0, 10) };
}

/** A YYYY-MM-DD day off the server will take: today or later, within the year. */
export function dayOffAllowed(day: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const { min, max } = dayOffBounds(now);
  return day >= min && day <= max;
}

/** "Thu, Nov 26", or "Wed, Jan 6, 2027" when the day is not in this year. */
export function dayOffLabel(day: string, now: Date = new Date()): string {
  const sameYear = day.slice(0, 4) === dayOffBounds(now).min.slice(0, 4);
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  });
}
