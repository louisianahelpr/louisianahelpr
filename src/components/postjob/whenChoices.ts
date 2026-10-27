/**
 * Board 45 (Post a job, "When and where?"): the day strip and the time chips.
 * Pure, so the strip's days can be proven in every device zone
 * (src/test/postJobDayStrip.tz.test.tsx).
 */

/** How many days the strip shows before "More dates" (the board's five). */
export const DAY_STRIP_LENGTH = 5;

export interface StripDay {
  /** `YYYY-MM-DD`, the shape jobs.date_needed stores. */
  iso: string;
  /** "Wed" */
  weekday: string;
  /** 28 */
  day: number;
  /** "Wednesday, October 28": the card's accessible name. */
  long: string;
}

/**
 * `count` calendar days from `todayIso` (pass `todayYmd()`, Louisiana's today).
 * Built on UTC noon, never the device's clock: the date string is the fact, and
 * noon cannot slip a day in any zone or across a DST change.
 */
export function dayStrip(todayIso: string, count = DAY_STRIP_LENGTH): StripDay[] {
  const [y, m, d] = todayIso.split("-").map(Number);
  const days: StripDay[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(y, m - 1, d + i, 12));
    days.push({
      iso: at.toISOString().slice(0, 10),
      weekday: at.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day: at.getUTCDate(),
      long: at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    });
  }
  return days;
}

/** The board's common start times; "Other time" opens the wheel for any other. */
export const TIME_CHIPS: readonly { value: string; label: string }[] = [
  { value: "08:00", label: "8:00 AM" },
  { value: "09:00", label: "9:00 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "13:00", label: "1:00 PM" },
];

/** The chip a stored start_time ("09:00" or "09:00:00") matches, if any. */
export function timeChipOf(startTime: string): string | null {
  const hhmm = startTime.trim().slice(0, 5);
  return TIME_CHIPS.find((t) => t.value === hhmm)?.value ?? null;
}
