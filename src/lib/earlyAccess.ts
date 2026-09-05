// Single source of truth for the subscription "early access" perk delay.
//
// Free/no-tier users see brand-new jobs only after a 20-minute delay;
// Basic shaves 5 min off, Pro 10, Plus 15, Elite the full 20 (they see jobs
// immediately). This perk applies to ALL users equally regardless of role.
//
// Elite used to share its branch with a `business` tier that no longer exists
// (removed 2026-09-01 — see subscriptionTiers.ts). A stray "business" now takes
// the `else 0` branch and waits the full 20 minutes, the safe direction: an
// unrecognised tier loses a perk rather than being handed one.
//
// THIS MODULE IS NOT THE ENFORCEMENT POINT, and calling it one was the bug.
// The perk is enforced in Postgres by `public.early_access_cutoff()`
// (migration 20260901022522), which all three browse surfaces compare against:
// `/jobs` (get_ranked_open_jobs), the dashboard list (the open_jobs_browse
// view) and the map (get_open_jobs_for_map). Before that migration the only
// server-side gate was the map's; the dashboard shipped a cutoff the CLIENT
// computed and attached as `.lte("created_at", …)`, and `/jobs` had no gate at
// all — so a paid perk was one deleted line of JS, or one private window, away
// from free.
//
// What still consumes this module is the CLIENT half: the `.lte` pre-filter in
// useDashboardData, the per-job gate in useDashboardFilters, the count query in
// useDashboardJobsCount and the map's client filter. All of them can only
// subtract rows the server already permitted, never add one. They MUST keep
// using the same formula as the SQL — `earlyAccess.parity.test.ts` grades the
// migration text against this file — or the two disagree and a job passes one
// layer but not the other.
/**
 * The ONE client-side resolution of "which tier does this user's early-access
 * perk run at", from their own profile row. Every client layer uses it (the
 * useDashboardData pre-filter, the per-job gate in useDashboardFilters, the
 * count in useDashboardJobsCount), which is what stopped THOSE disagreeing.
 *
 * CONVENTION (matches `tierFeePercent` in subscriptionTiers.ts and
 * `feePercentForTier` in the edge payout resolver): a null expiry means ACTIVE
 * — the expire-subscriptions cron nulls the tier on lapse, so only a stamped
 * PAST date means expired.
 *
 * `get_open_jobs_for_map` read that convention BACKWARDS until 20260901022522
 * (`WHEN subscription_expires_at IS NULL OR … <= now() THEN NULL`), so a member
 * holding a paid tier with a NULL expiry — a manual or legacy grant — got the
 * early feed in the list and the free one on the map, and their pins vanished
 * when they toggled between the two. The parity test asserted only that the SQL
 * contained `subscription_expires_at <= now()`, which was true of both
 * readings; it now grades the whole predicate.
 */
export function resolveEarlyAccessTier(
  subscriptionTier: string | null | undefined,
  subscriptionExpiresAt: string | null | undefined,
): string | null {
  const expired = subscriptionExpiresAt
    ? new Date(subscriptionExpiresAt).getTime() < Date.now()
    : false;
  return expired ? null : (subscriptionTier ?? null);
}

export function earlyAccessDelayMs(tier: string | null | undefined): number {
  const earlyMinutes =
    tier === "elite" ? 20
    : tier === "plus" ? 15
    : tier === "pro" ? 10
    : tier === "basic" ? 5
    : 0;
  return (20 - earlyMinutes) * 60 * 1000;
}
