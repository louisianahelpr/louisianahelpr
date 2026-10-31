/**
 * What open_jobs_browse gives a signed-out visitor for customer_id (20261031000945): all zeros, never the poster's
 * id and never NULL. Every client's browse cull drops an empty id (useDashboardFilters), and the phone apps keep
 * theirs until they update, so NULL would empty their feed.
 */
export const GUEST_POSTER_ID = "00000000-0000-0000-0000-000000000000";

/** The ids worth looking up: not a deleted poster's null (a malformed uuid[] filter), not the guest's all-zero id. */
export function guestPosterIds(jobs: readonly { customer_id?: string | null }[]): string[] {
  return [...new Set(jobs.map((j) => j.customer_id).filter((id): id is string => !!id && id !== GUEST_POSTER_ID))];
}
