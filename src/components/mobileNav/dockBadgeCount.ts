/** The phone dock's badge number for one item (moved out of MobileNav.tsx to keep it under its size ratchet). */
import type { NeedsYouCounts } from "@/lib/needsYouStore";
import type { DockItem } from "./dockItems";

/** Messages: unread chats; Explore and the section tabs: the To-do count (the same list Home shows). */
export function dockBadgeCount(badgeKey: DockItem["badgeKey"], unreadCount: number, todo: NeedsYouCounts): number {
  return badgeKey === "messages"
    ? unreadCount
    : badgeKey === "todo"
      ? todo.total
      : badgeKey === "todoJobs"
        ? todo.jobs
        : badgeKey === "todoShops"
          ? todo.shops
          : badgeKey === "todoDeclutter"
            ? todo.declutter
            : 0;
}
