import type { tierBadgeStyle } from "@/lib/tierBadgeStyle";

/**
 * The paid-tier (Pro / Plus / Elite) badge style. Memberships are RETIRED
 * (owner 2026-11-04: no tier differences anywhere), so no member ever shows a
 * paid-tier badge: the answer is always null. Every paid-tier chip reads this,
 * never tierBadgeStyle directly.
 * Guards: src/test/paidTierBadgeNeedsMemberships.test.ts, src/test/membershipsRetired.test.ts.
 */
export function usePaidTierBadge(): (tier: string | null | undefined) => ReturnType<typeof tierBadgeStyle> {
  return () => null;
}
