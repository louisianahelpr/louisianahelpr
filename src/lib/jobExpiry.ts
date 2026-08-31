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
export const MIN_LISTING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
 */
export function isScheduleInThePast(
  dateNeeded: string,
  startTime: string,
  now: Date = new Date(),
): boolean {
  if (!dateNeeded || !startTime) return false;
  const scheduled = scheduledInstant(dateNeeded, startTime);
  return scheduled !== null && scheduled.getTime() <= now.getTime();
}
