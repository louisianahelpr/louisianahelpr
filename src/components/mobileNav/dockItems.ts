import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * THE ONE FLAG for closed sections in the NATIVE app's dock. FALSE since 11-14 (lead, with Shops and Homes back in the
 * dock): the 10-31 rule (hideUnopenedInApp, App Review 2.1): a section tab is in the iPhone/Android dock only once it
 * is open to that member and not a tester-only preview (sectionListedHere), so the store app never shows a tab that
 * opens a coming-soon screen; there the dock is Home, Jobs, Declutter (plus Shops / Homes once open), and Messages and
 * You are on the top row. True was the owner's 11-06 choice ("remove that from the tabs, the screen says it is
 * coming") for the then Dashboard/Jobs/Declutter/Shops/Homes dock: listed in the app with no mark. One-line flip.
 * Guard: src/test/navSoonAndTopMessages.test.tsx.
 */
export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = false;

export type DockItem = { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "todo" | "todoJobs" | "todoShops" | "todoDeclutter"; comingSoon?: boolean };

/**
 * The PHONE bottom bar (owner 11-14, replacing F146's Messages and You: "Messages and You are already at the top, so
 * replace those with Shops and Homes and just have those 2 listed as coming soon"): Home, Jobs, Declutter, Shops,
 * Homes. Messages is the top row's chat button and You its photo (AppTopBar). Shops and Homes wear a "Soon" tag while
 * not open to everyone (MobileNav reads useSectionTabs; never in the store app, hideUnopenedInApp) and open their own
 * coming-soon screens (ShopsGate, RentalsGate) for anyone they are closed to. Each section tab carries its share of
 * the to-do count, as on the desktop rail. `comingSoon` marks the two tabs that may wear the tag (never Declutter, which
 * is open to everyone and would flash "Soon" while its switch loads). Guard: src/test/navSoonAndTopMessages.test.tsx.
 */
export function phoneDockItems(): DockItem[] {
  const dashboard = leftItems[0];
  const jobs = rightItems.find((i) => i.path === "/jobs")!;
  const section = (path: string) => sectionItems.find((s) => s.path === path)!;
  const declutter = section("/declutter");
  const shops = section("/shops");
  const homes = section("/rentals");
  return [
    { path: dashboard.path, icon: dashboard.icon, label: "Home" },
    { path: jobs.path, icon: jobs.icon, label: jobs.label, badgeKey: "todoJobs" },
    { path: declutter.path, icon: declutter.icon, label: declutter.label, badgeKey: "todoDeclutter" },
    { path: shops.path, icon: shops.icon, label: shops.label, badgeKey: "todoShops", comingSoon: true },
    { path: homes.path, icon: homes.icon, label: homes.label, comingSoon: true },
  ];
}
