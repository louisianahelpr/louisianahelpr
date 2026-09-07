import { jobStartDateTime } from "@/lib/dateUtils";

/**
 * The one client-side definition of a job listing's expiry.
 *
 * `jobs.expires_at` gates whether a job is visible at all: the dashboard feed
 * (`useDashboardData`) and the map RPC (`get_open_jobs_for_map`) both drop
 * anything with `expires_at <= now()`. So an expiry in the past is not a
 * cosmetic bug — it is a paid listing no helper can ever see.
 *
 * Two rules, and both are mirrored server-side by the
 * `trg_job_expiry_floor` trigger (migration 20260831201631) so no client can
 * get around them:
 *
 *  1. The expiry is derived from the schedule — the job's start time, or the
 *     end of its day when there's no start time.
 *  2. It is floored at `now + MIN_LISTING_WINDOW_MS`, so a job can never be
 *     created (or rescheduled) into an already-expired state.
 */

/** Shortest window a listing is allowed to stay visible for. */
const MIN_LISTING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Parses `date_needed` + `start_time` as a local wall-clock instant.
 *
 * `start_time` arrives as "HH:MM" from the form and "HH:MM:SS" from Postgres;
 * both parse. Returns null when there's no date, or when the pieces don't
 * form a real date.
 */
function scheduledInstant(dateNeeded: string, startTime: string): Date | null {
  if (!dateNeeded) return null;
  const time = startTime ? startTime : "23:59:59";
  const parsed = new Date(`${dateNeeded}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The listing expiry for a given schedule, floored so it is always in the
 * future. Returns null when the job has no date (never expires).
 */
export function computeJobExpiresAt(
  dateNeeded: string,
  startTime: string,
  now: Date = new Date(),
): string | null {
  const scheduled = scheduledInstant(dateNeeded, startTime);
  if (!scheduled) return null;
  const floor = now.getTime() + MIN_LISTING_WINDOW_MS;
  return new Date(Math.max(scheduled.getTime(), floor)).toISOString();
}

/**
 * True when the given date+time is already in the past — i.e. the poster
 * picked today and a start time that has already gone by. The wizard refuses
 * this outright rather than quietly shifting their time, so the poster fixes
 * it BEFORE they are charged.
 *
 * Resolved in the JOB's zone via `jobStartDateTime`, NOT the runtime's.
 * This used to build its own instant with `new Date(\`${date}T${time}\`)`,
 * which reads the poster's browser zone — a fourth hand-rolled parse of a
 * question the app had already answered once. A poster in Pacific composing a
 * Louisiana job at 9:00 AM was being asked whether 9:00 AM *Pacific* had
 * passed; the job starts at 9:00 AM Central, two hours earlier in real time,
 * so the wizard let through afternoon jobs that were already underway and
 * refused morning ones that were not. `jobStartDateTime` takes its offset at
 * the start instant, so a job on a DST boundary is not an hour out either.
 *
 * `now` and `timeZone` stay injectable so a test can assert two different
 * zones resolve to two different correct answers — without that, a test built
 * on the runtime's own zone on both sides cancels the offset and cannot fail.
 */
export function isScheduleInThePast(
  dateNeeded: string,
  startTime: string,
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  if (!dateNeeded || !startTime) return false;
  const scheduled = jobStartDateTime(dateNeeded, startTime, timeZone);
  return scheduled !== null && scheduled.getTime() <= now.getTime();
}
