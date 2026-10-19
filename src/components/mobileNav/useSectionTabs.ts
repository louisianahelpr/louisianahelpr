import { toast } from "sonner";
import { useFeature } from "@/hooks/useFeature";
import { sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * The section tabs (owner, 2026-10-18, option 1A): Declutter, Shops and Homes,
 * ALWAYS listed. A section whose feature switch is on for this viewer is live
 * (`on: true`); one whose switch is off is shown GREYED and never navigates:
 * tapping it says "coming soon" (owner, 2026-10-18: "show it greyed out so
 * everyone sees Declutter / Shops / Homes are coming"). The switch is only
 * READ here, never changed. useFeature is false while loading, on error and
 * signed out, so a section is never live for someone it is hidden from.
 *
 * The dock (MobileNav) and the desktop rail (DesktopSidebarNav) both read this
 * one list, so the two cannot drift.
 */
export function useSectionTabs() {
  const declutter = useFeature("declutter");
  const shops = useFeature("shops");
  const rentals = useFeature("rentals");
  const on = { declutter, shops, rentals } as const;
  return sectionItems.map((s) => ({ ...s, on: on[s.feature] }));
}

/** The accessible name of a switched-off section: "Declutter, coming soon". */
export const comingSoonLabel = (label: string) => `${label}, coming soon`;

/** What a tap on a switched-off section does instead of navigating. */
export function sayComingSoon(label: string) {
  toast(`${label} is coming soon`, { id: `coming-soon-${label}` });
}
