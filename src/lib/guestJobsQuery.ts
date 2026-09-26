/**
 * DashboardGuest's job-list query, and the hand-over from the entry's
 * prefetch of it (Q206 b, src/boot/guestJobsPrefetch.ts).
 *
 * Imported by DashboardGuest ONLY. It is in src/lib, so a second importer
 * would move it into the app-shared chunk (vite.config.ts); the entry must
 * never import it, see the boot module for why.
 */

/** `latitude, longitude` are the view's MASKED coordinates (20260903031231). */
export const GUEST_JOBS_SELECT =
  "id, title, description, category, budget, date_needed, location, latitude, longitude, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status, pricing_mode, credential_tier, parish";
export const GUEST_JOBS_LIMIT = 40;

/** Same string as GUEST_JOBS_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhGuestJobsPrefetch";
/** A prefetch older than this is not handed out: the queryFn asks afresh. */
export const GUEST_JOBS_PREFETCH_MAX_AGE_MS = 30_000;

/**
 * The prefetched rows, ONCE (a refetch must reach the server), or null when
 * there is none, it is too old, or it failed.
 */
export function takeGuestJobsPrefetch(now: number = Date.now()): Promise<unknown[] | null> | null {
  const w = window as unknown as Record<string, { at: number; rows: Promise<unknown[] | null> } | undefined>;
  const p = w[KEY];
  w[KEY] = undefined;
  if (!p || now - p.at > GUEST_JOBS_PREFETCH_MAX_AGE_MS) return null;
  return p.rows;
}
