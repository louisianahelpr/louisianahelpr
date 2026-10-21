import { useFeature } from "@/hooks/useFeature";
import { tierBadgeStyle } from "@/lib/tierBadgeStyle";

/**
 * The paid-tier (Pro / Plus / Elite) badge style, or null while the
 * 'memberships' switch is off (owner, 2026-10-21, Q1848 follow-up: every paid
 * perk is off while memberships are off, the badge included). Every paid-tier
 * chip reads this, never tierBadgeStyle directly. useFeature is false while
 * loading and on error, so a badge never shows for someone it is hidden from.
 * Guard: src/test/paidTierBadgeNeedsMemberships.test.ts.
 */
export function usePaidTierBadge(): (tier: string | null | undefined) => ReturnType<typeof tierBadgeStyle> {
  const on = useFeature("memberships");
  return (tier) => (on ? tierBadgeStyle(tier) : null);
}
