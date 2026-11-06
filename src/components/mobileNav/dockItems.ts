import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * THE ONE FLAG for closed sections in the NATIVE app's dock. True (owner, 11-06 11:35 AM, told of the App Review
 * risk: "remove that from the tabs, the screen says it is coming"): Shops and Homes are listed in the iPhone/Android
 * dock as on the web, with no "Soon" mark, and open their own coming-soon screen. False brings back the 10-31 rule
 * (left out of the app's dock until they open). One-line flip.
 */
export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = true;

export type DockItem = { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "todo" | "todoJobs" | "todoShops" | "todoDeclutter"; comingSoon?: boolean };

/**
 * The PHONE bottom bar (owner, nav redesign 2026-11-06): Dashboard, Jobs, Declutter, Shops, Homes. Five tabs and no
 * center "+": creating moved to the top bar's per-section "+" (AppTopBar), and Messages moved up beside You. Explore
 * left the dock (its section tiles live on Dashboard). Each section tab carries its share of the to-do count, as on
 * the desktop rail; a section not open to the viewer has no "Soon" mark and opens its own coming-soon screen
 * (MobileNav reads useSectionTabs). Guard: src/test/centerCreateNav.test.tsx.
 */
export function phoneDockItems(): DockItem[] {
  const dashboard = leftItems[0];
  const jobs = rightItems.find((i) => i.path === "/jobs")!;
  const section = (path: string) => sectionItems.find((s) => s.path === path)!;
  const declutter = section("/declutter");
  const shops = section("/shops");
  const homes = section("/rentals");
  return [
    { path: dashboard.path, icon: dashboard.icon, label: dashboard.label },
    { path: jobs.path, icon: jobs.icon, label: jobs.label, badgeKey: "todoJobs" },
    { path: declutter.path, icon: declutter.icon, label: declutter.label, badgeKey: "todoDeclutter" },
    { path: shops.path, icon: shops.icon, label: shops.label, badgeKey: "todoShops" },
    { path: homes.path, icon: homes.icon, label: homes.label },
  ];
}
