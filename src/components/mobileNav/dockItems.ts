import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * THE ONE FLAG for closed sections in the NATIVE app's dock. True (owner, 11-06 11:35 AM, told of the App Review
 * risk: "remove that from the tabs, the screen says it is coming"): a section tab is listed in the iPhone/Android
 * dock as on the web, with no "Soon" mark, and opens its own coming-soon screen. False brings back the 10-31 rule
 * (left out of the app's dock until it opens). One-line flip. Since F146 (11-09) the only section tab is Declutter.
 */
export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = true;

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
