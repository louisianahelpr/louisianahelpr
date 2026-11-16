import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, sectionItems } from "@/components/mobileNav/mobileNavHelpers";

/**
 * THE ONE FLAG for a tester's PREVIEW section in the NATIVE app's dock. M8/M9 (owner 11-16): "hide Shops and Homes
 * from members everywhere ... until they launch", so a section CLOSED to the viewer is never in the dock, on the
 * website or in the app. Admins and testers keep their existing access (owner 11-16): in the app their preview tab is
 * listed with NO "Soon" mark (owner 11-06/11-14, hideUnopenedInApp). False leaves previews out of the app's dock too.
 * Guard: src/test/navSoonAndTopMessages.test.tsx.
 */
export const DOCK_LISTS_PREVIEWS_IN_APP = true;

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
