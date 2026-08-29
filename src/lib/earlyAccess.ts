// Single source of truth for the subscription "early access" perk delay.
//
// Free/no-tier users see brand-new jobs only after a 20-minute delay;
// Basic shaves 5 min off, Pro 10, Elite & Business the full 20 (they
// see jobs immediately). This perk applies to ALL users equally regardless of role.
//
// Two layers consume this: the SQL `created_at` cutoff in useDashboardData
// (server-side pre-filter) and the per-job gate in useDashboardFilters
// (client-side). Both MUST use the same formula or the two disagree and a
// job can pass one gate but not the other.
/**
 * The ONE resolution of "which tier does this user's early-access perk run
 * at", from their profile row. Both layers of the gate use it — the SQL
 * `created_at` cutoff in useDashboardData and the per-job client gate in
 * useDashboardFilters — which is what stopped them disagreeing: the server
 * layer used to treat a NULL `subscription_expires_at` as inactive while the
 * client layer graded a different tier source entirely.
 *
 * CONVENTION (matches `tierFeePercent` in subscriptionTiers.ts and the edge
 * payout resolver): a null expiry means ACTIVE — the expire-subscriptions
 * cron nulls the tier on lapse, so only a stamped PAST date means expired.
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
    tier === "elite" || tier === "business" ? 20
    : tier === "pro" ? 10
    : tier === "basic" ? 5
    : 0;
  return (20 - earlyMinutes) * 60 * 1000;
}
