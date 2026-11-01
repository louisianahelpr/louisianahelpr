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

type TimeChip = { value: string; label: string };

/** "12:30" -> "12:30 PM". */
function chipLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The start-time chips for the picked day (audit 11-01 JA-44: with today picked at 9:47 AM the chips still offered
 * 8, 9 and 10 AM, and picking one only showed "Pick a later start"). Today offers only the starts it allows: the
 * earliest one (`earliest`, sameDayStartTime) first, then the board's later chips; `earliest` null (today is closed)
 * offers none. Any other day: the board's chips.
 */
export function timeChipsFor(dateIso: string, todayIso: string, earliest: string | null): readonly TimeChip[] {
  if (dateIso !== todayIso) return TIME_CHIPS;
  if (!earliest) return [];
  const later = TIME_CHIPS.filter((t) => t.value > earliest);
  return [{ value: earliest, label: chipLabel(earliest) }, ...later];
}

/** The chip a stored start_time ("09:00" or "09:00:00") matches, if any. */
export function timeChipOf(startTime: string, chips: readonly TimeChip[] = TIME_CHIPS): string | null {
  const hhmm = startTime.trim().slice(0, 5);
  return chips.find((t) => t.value === hhmm)?.value ?? null;
}
