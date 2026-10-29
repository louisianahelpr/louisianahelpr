/**
 * Q2438 (owner-approved 2026-10-27): same-day ("Need it today") jobs.
 *
 * "Need it today" on Post a job sets the date to Louisiana's today and the
 * start to the soonest time the server accepts: refuse_short_notice_job
 * (live 2026-10-27) refuses a start under 2 hours away, so the start is now +
 * 2 hours plus a 10-minute margin for the poster to finish checkout, rounded
 * up to the next half hour. The listing then closes at that start
 * (refuse_short_notice_job sets expires_at to it), so a same-day job is open
 * for a few hours, not days, and nobody can be hired after it starts.
 *
 * After funding, instant-job-match sends it first to Helprs who are online
 * ("Available now") and nearby (supabase/functions/_shared/sameDayMatch.ts).
 * Cards show a "Today" chip for any open job dated Louisiana's today.
 */
import { todayYmd } from "@/lib/jobDate";

/** The server's minimum notice (refuse_short_notice_job). */
const SAME_DAY_MIN_NOTICE_MIN = 120;
/** Time to finish checkout before the notice runs short. */
const CHECKOUT_MARGIN_MIN = 10;
/** The latest start "Need it today" offers (9:00 PM). */
const SAME_DAY_LATEST_START = "21:00";
/**
 * The earliest start it offers: 8:00 AM, the form's first time chip (whenChoices TIME_CHIPS). A2-C27 (app
 * audit 2026-10-28): at 00:33 it filled "Today, starting 3:00 AM".
 */
const SAME_DAY_EARLIEST_START = "08:00";

/** Louisiana wall-clock minutes since midnight for `now`. */
function louisianaMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * The start "Need it today" fills in ("HH:MM", Louisiana time), never before
 * 8:00 AM, or null when it is too late for a job today (the soonest allowed
 * start is after 9:00 PM).
 */
export function sameDayStartTime(now: Date = new Date()): string | null {
  const earliest = louisianaMinutes(now) + SAME_DAY_MIN_NOTICE_MIN + CHECKOUT_MARGIN_MIN;
  const [eh, em] = SAME_DAY_EARLIEST_START.split(":").map(Number);
  const rounded = Math.max(Math.ceil(earliest / 30) * 30, eh * 60 + em);
  const [lh, lm] = SAME_DAY_LATEST_START.split(":").map(Number);
  if (rounded > lh * 60 + lm) return null;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

/** True for a job dated Louisiana's today (the "Today" chip). */
export function isTodayJob(dateNeeded: string | null | undefined, today: string = todayYmd()): boolean {
  return typeof dateNeeded === "string" && dateNeeded.slice(0, 10) === today;
}
