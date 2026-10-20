// The filter sheet's "When" chips (board 24): which DAY the job is on, read
// from `date_needed` in the platform's zone (America/Chicago, `todayYmd`).
//
// One definition for the three layers that must agree: the list
// (useDashboardFilters), the map (mapFilter.ts) and the server count
// (useDashboardJobsCount). "next7" is today plus the six days after it, which
// is what the chip says ("Next 7 days"), not a calendar week.
import { todayYmd } from "@/lib/jobDate";

export type JobWhen = "" | "today" | "next7";

export const JOB_WHEN_OPTIONS: ReadonlyArray<{ value: JobWhen; label: string }> = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "next7", label: "Next 7 days" },
];

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive YYYY-MM-DD bounds for a When value, or null when it filters nothing. */
export function jobWhenRange(when: string, today: string = todayYmd()): { from: string; to: string } | null {
  if (when === "today") return { from: today, to: today };
  if (when === "next7") return { from: today, to: addDaysYmd(today, 6) };
  return null;
}

/** A job with no day set cannot be shown as "today": it is kept only by "Any time". */
export function jobMatchesWhen(dateNeeded: string | null | undefined, range: { from: string; to: string } | null): boolean {
  if (!range) return true;
  if (!dateNeeded) return false;
  const day = dateNeeded.slice(0, 10);
  return day >= range.from && day <= range.to;
}
