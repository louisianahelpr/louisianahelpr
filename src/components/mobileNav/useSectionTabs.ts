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

/**
 * ONE quiet line for every section not open yet (owner, 2026-10-21: no dead
 * "Opening soon" cards): "Declutter, Shops and Homes are opening soon",
 * "Homes is opening soon"; null when every section is open.
 */
export function openingSoonLine(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const names = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} ${labels.length === 1 ? "is" : "are"} opening soon`;
}

/** The accessible name of a switched-off section: "Declutter, coming soon". */
export const comingSoonLabel = (label: string) => `${label}, coming soon`;

const shownComingSoon = new Set<string>();

/** What a tap on a switched-off section does instead of navigating. */
export function sayComingSoon(label: string) {
  const id = `coming-soon-${label}`;
  shownComingSoon.add(id);
  toast(`${label} is coming soon`, { id });
}

/**
 * A "coming soon" toast belongs to the screen that was tapped (owner,
 * 2026-10-21: "Declutter is coming soon" showed on You › Money with no tap
 * there). It is dismissed the moment the route changes, so it can never be
 * seen on a screen where nobody tapped a section. Called on every pathname
 * change by ScrollToTop (mounted once, app-wide).
 */
export function dismissComingSoonToasts() {
  for (const id of shownComingSoon) toast.dismiss(id);
  shownComingSoon.clear();
}
