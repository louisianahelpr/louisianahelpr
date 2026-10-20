import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, jobsAndPostsItem, exploreItem, youItem } from "@/components/mobileNav/mobileNavHelpers";
import type { SectionDef } from "@/components/sections/sectionsConfig";

type Tab = { path: string; icon: LucideIcon; label: string; on: boolean };
export type DockItem = { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "posts" | "jobs" | "jobsAndPosts"; comingSoon?: boolean };

/**
 * The signed-in bottom nav (owner final decisions, 2026-10-19): Home, then the
 * member's shown sections in their order (Jobs & Posts, Declutter, Shops,
 * Homes by default), then MESSAGES with its unread badge. No "+". A section
 * whose switch is off for the viewer is listed greyed ("coming soon").
 * Hidden sections (Customize) are left out; Home and Messages always show.
 * Guard: src/test/dashboardsNav.test.tsx.
 */
export function dockItems(tabs: readonly Tab[], visible: readonly SectionDef[]): DockItem[] {
  const home = leftItems[0];
  const messages = rightItems.find((i) => i.path === "/messages")!;
  const sections: DockItem[] = visible.map((s) => {
    if (s.key === "jobs") return { ...jobsAndPostsItem, label: "Jobs" };
    const t = tabs.find((x) => x.path === s.path);
    return { path: s.path, icon: t?.icon ?? s.icon, label: s.navLabel, comingSoon: t ? !t.on : false };
  });
  return [home, ...sections, { path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" }];
}

/**
 * The PHONE bottom bar (owner-approved mock-up, 2026-10-20): Home and Explore
 * left of the center "+", Messages and You right of it. The sections moved
 * into Explore, so Customize's hide/reorder shows there (and on Home and the
 * desktop rail, which keeps `dockItems`). Guard: src/test/centerCreateNav.test.tsx.
 */
export function phoneDockItems(): { left: DockItem[]; right: DockItem[] } {
  const home = leftItems[0];
  const messages = rightItems.find((i) => i.path === "/messages")!;
  return {
    left: [home, exploreItem],
    right: [{ path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" }, youItem],
  };
}
