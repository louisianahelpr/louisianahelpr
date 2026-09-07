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

/**
 * The base wait, in minutes, that a brand-new job sits invisible to a member
 * with NO early-access perk. Every tier's head start is measured against it,
 * so this is the one place the number 20 is written down on the client.
 *
 * COPY MUST DERIVE FROM THIS, NEVER RETYPE IT. Four tier bullets in
 * `subscriptionTiers.ts` said "5-min / 10-min / 15-min / 20-min early access"
 * as string literals, so the storefront's promise and the SQL gate were two
 * independent numbers that happened to agree — a shape this codebase has been
 * burned by repeatedly (the Elite $15/$20 price, the `plus` fee ladder). The
 * SQL side is already pinned to this module by `earlyAccess.parity.test.ts`;
 * routing the COPY through the same module extends that guard to the words.
 */
export const MAX_EARLY_ACCESS_DELAY_MINUTES = 20;

export function earlyAccessDelayMs(tier: string | null | undefined): number {
  return earlyAccessWaitMinutes(tier) * 60 * 1000;
}

/**
 * How many minutes a member on `tier` waits before a new job becomes visible
 * to them. `MAX_EARLY_ACCESS_DELAY_MINUTES` for free/unknown, 0 for Elite.
 */
export function earlyAccessWaitMinutes(tier: string | null | undefined): number {
  return MAX_EARLY_ACCESS_DELAY_MINUTES - earlyAccessHeadStartMinutes(tier);
}

/**
 * How many minutes SOONER than a free member this tier sees a new job — the
 * figure the membership storefront advertises ("10-min early access").
 */
export function earlyAccessHeadStartMinutes(tier: string | null | undefined): number {
  return (
    tier === "elite" ? 20
    : tier === "plus" ? 15
    : tier === "pro" ? 10
    : tier === "basic" ? 5
    : 0
  );
}
