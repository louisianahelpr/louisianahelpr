/**
 * Continue another day, the WORDS (owner 2026-11-01, Yusef's job): pure functions with no Supabase import, so the
 * shared tracker rules (jobProgressState), Home and the chat's job card read the same line as the job page.
 * The calls live in src/lib/continueDay.ts, which re-exports all of this.
 * Guards: src/lib/continueDay.test.ts, src/test/continueDayEverywhere.test.tsx.
 */
import { nextStepWords, type NextStepValue } from "@/components/ui/NextStep";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";

export type ContinueDay = {
  id: string;
  job_id: string;
  proposed_by: string | null;
  new_date: string;
  new_start_time: string;
  note: string | null;
  status: "proposed" | "set";
  helper_confirmed_at: string | null;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Thu 11/5 at 9 AM" / "Thu 11/5 at 1:30 PM": the server's continue_day_label, the same words in every notice. */
export function continueDayLabel(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh)) return "";
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const clock = mm ? `${h12}:${String(mm).padStart(2, "0")}` : `${h12}`;
  return `${weekday} ${m}/${d} at ${clock} ${hh < 12 ? "AM" : "PM"}`;
}

/**
 * The job's next-step line while it continues on another day, for the job's two people. Null when there is no
 * active continue day (the tracker's own line stands). Once the Helpr confirms a set day, BOTH sides say so (the
 * poster read "waiting on Yusef" after he had confirmed: Auditor 11, 11-01).
 */
export function continueDayNextStep(
  row: ContinueDay | null | undefined,
  o: { side: "poster" | "helpr"; otherFirst?: string | null },
): NextStepValue | null {
  if (!row) return null;
  const when = continueDayLabel(row.new_date, row.new_start_time);
  const other = (o.otherFirst ?? "").trim();
  if (row.status === "proposed") {
    return o.side === "poster"
      ? { who: "you", text: `Confirm ${other ? `${other}'s` : "your Helpr's"} new day`, by: when }
      : { who: "them", text: `You asked to finish ${when}`, by: `waiting on ${other || "the person who posted it"}` };
  }
  if (o.side === "poster") {
    return row.helper_confirmed_at
      ? { who: "info", text: `${other || "Your Helpr"} confirmed ${when}` }
      : { who: "them", text: `Continuing ${when}`, by: `waiting on ${other || "your Helpr"} to confirm` };
  }
  return row.helper_confirmed_at
    ? { who: "info", text: `You're set for ${when}`, by: "mark it done when you finish" }
    : { who: "you", text: "Confirm you'll be there", by: `continuing ${when}` };
}

/** The same line as one string, for a list row (Home, a chat's job card). */
export function continueDayWords(
  row: ContinueDay | null | undefined,
  o: { side: "poster" | "helpr"; otherFirst?: string | null },
): string | null {
  const step = continueDayNextStep(row, o);
  return step ? nextStepWords(step) : null;
}

/** Today in Louisiana ("2026-11-01"), the day the server's continue_day_ahead check reads. */
function louisianaToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/**
 * A SET day still ahead (Louisiana's date before it): the server refuses "done" until that day
 * (refuse_done_before_continue_day, continue_day_ahead), so no screen leads with it.
 */
export function continueDayAhead(row: ContinueDay | null | undefined, now: Date = new Date()): boolean {
  return !!row && row.status === "set" && !!row.new_date && louisianaToday(now) < row.new_date;
}

/** The job page's first line on a SET day: "Continuing Thu, Nov 5 · 9:00 AM" (null: day 1's line stands). */
export function continueDayHeader(row: ContinueDay | null | undefined): string | null {
  if (!row || row.status !== "set" || !row.new_date) return null;
  return ["Continuing " + formatJobDate(row.new_date), jobStartTimeLabel(row.new_start_time.slice(0, 5))].filter(Boolean).join(" · ");
}

/**
 * The job as its tracker should read it while it continues on a SET day (B118 follow-up, lead 11-01): the new day
 * and start time stand in for day 1's, so the bar and its "late" checks measure the next visit, never the first
 * day that has passed (the bar read "Late" on Arrived with a day set). A proposed day is not agreed yet: day 1 stands.
 */
export function jobOnContinueDay<J extends { date_needed?: string | null; start_time?: string | null }>(
  job: J,
  row: ContinueDay | null | undefined,
): J {
  if (!row || row.status !== "set" || !row.new_date) return job;
  return { ...job, date_needed: row.new_date, start_time: row.new_start_time.slice(0, 5) };
}
