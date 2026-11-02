import type { LucideIcon } from "lucide-react";
import { leftItems, rightItems, exploreItem, youItem } from "@/components/mobileNav/mobileNavHelpers";

export type DockItem = { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "todo" | "todoJobs" | "todoShops" | "todoDeclutter"; comingSoon?: boolean };

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
