import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, sectionItems, youItem } from "@/components/mobileNav/mobileNavHelpers";

/**
 * THE ONE FLAG for closed sections in the NATIVE app's dock. True (owner, 11-06 11:35 AM, told of the App Review
 * risk: "remove that from the tabs, the screen says it is coming"): a section tab is listed in the iPhone/Android
 * dock as on the web, with no "Soon" mark, and opens its own coming-soon screen. False brings back the 10-31 rule
 * (left out of the app's dock until it opens). One-line flip. Since F146 (11-09) the only section tab is Declutter.
 */
export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = true;

export type DockItem = { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "todo" | "todoJobs" | "todoShops" | "todoDeclutter"; comingSoon?: boolean };

/**
 * The PHONE bottom bar (owner UI audit F146, 2026-11-09, replacing the 11-06 Dashboard/Jobs/Declutter/Shops/Homes
 * dock): "Home · Jobs · Declutter · Messages · You" in the owner's words (Home is the /home Dashboard; the rail keeps
 * "Dashboard"), Messages with its unread badge. Shops and Homes are not open yet, so they
 * left the dock; until they open they are reached from Dashboard's section tiles and Explore. Each section tab carries
 * its share of the to-do count, as on the desktop rail. Guard: src/test/centerCreateNav.test.tsx.
 */
export function phoneDockItems(): DockItem[] {
  const dashboard = leftItems[0];
  const jobs = rightItems.find((i) => i.path === "/jobs")!;
  const messages = rightItems.find((i) => i.path === "/messages")!;
  const declutter = sectionItems.find((s) => s.path === "/declutter")!;
  return [
    { path: dashboard.path, icon: dashboard.icon, label: "Home" },
    { path: jobs.path, icon: jobs.icon, label: jobs.label, badgeKey: "todoJobs" },
    { path: declutter.path, icon: declutter.icon, label: declutter.label, badgeKey: "todoDeclutter" },
    { path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" },
    { path: youItem.path, icon: youItem.icon, label: youItem.label },
  ];
}
