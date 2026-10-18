import { useFeature } from "@/hooks/useFeature";
import { sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * The section tabs this viewer may see (owner, 2026-10-18, option 1A): each
 * of Declutter, Shops and Homes only while its feature switch is on for them.
 * Never changes a switch; only reads it (useFeature is false while loading,
 * on error and signed out, so a section never flickers in for someone it is
 * hidden from).
 *
 * The dock (MobileNav), Home's top row (DashboardTitleBar) and the desktop
 * rail (DesktopSidebarNav) all read this one list, so the three cannot drift.
 */
export function useSectionTabs() {
  const declutter = useFeature("declutter");
  const shops = useFeature("shops");
  const rentals = useFeature("rentals");
  const on = { declutter, shops, rentals } as const;
  return sectionItems.filter((s) => on[s.feature]);
}
