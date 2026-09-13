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
 * The listing expiry for a given schedule, floored so it is always in the
 * future. Returns null when the job has no date (never expires).
 *
 * Resolved in the JOB's zone (America/Chicago) via `jobStartDateTime`, not the
 * poster's browser zone. It used `new Date(\`${date}T${time}\`)`, so a 9:00 AM
 * Louisiana job posted from Pacific time stayed listed about two hours after
 * it started, and one posted from Eastern time vanished an hour early. The
 * server trigger only raises an expiry already in the past, so it never
 * corrected either (time-travel audit, 2026-09-12). No start time means the
 * end of the job's day.
 */
export function computeJobExpiresAt(
  dateNeeded: string,
  startTime: string,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  if (!dateNeeded) return null;
  const scheduled = jobStartDateTime(dateNeeded, startTime ? startTime : "23:59", timeZone);
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
