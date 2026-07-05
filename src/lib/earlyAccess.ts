// Single source of truth for the subscription "early access" perk delay.
//
// Free/no-tier users see brand-new jobs only after a 20-minute delay;
// Basic shaves 5 min off, Pro 10, Elite & Business the full 20 (they see jobs
// immediately). This perk applies to ALL users equally regardless of role.
//
// Two layers consume this: the SQL `created_at` cutoff in useDashboardData
// (server-side pre-filter) and the per-job gate in useDashboardFilters
// (client-side). Both MUST use the same formula or the two disagree and a
// job can pass one gate but not the other.
export function earlyAccessDelayMs(tier: string | null | undefined): number {
  const earlyMinutes =
    tier === "elite" || tier === "business" ? 20
    : tier === "pro" ? 10
    : tier === "basic" ? 5
    : 0;
  return (20 - earlyMinutes) * 60 * 1000;
}
