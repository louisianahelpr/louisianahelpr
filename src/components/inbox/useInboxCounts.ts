import { useSyncExternalStore } from "react";
import { useSharedUnreadCount } from "@/components/mobileNav/navUnreadStore";
import {
  bellUnreadCount,
  getNotificationServerSnapshot,
  getNotificationSnapshot,
  subscribeNotifications,
} from "@/components/notificationPanel/notificationStore";

/**
 * The Inbox's two unread counts and their sum (owner 11-15, one icon with one badge). READ ONLY, no request of its
 * own: Messages is the shared Q103 store (unread threads + unread shop chats, S2-016, one read filled by
 * useNavUnreadCount in MobileNav / the desktop rail) and Notifications is the shared bell store (the counted
 * database total, bellUnreadCount). The icon's badge, the Messages tab and the Notifications tab all read here, so
 * the three numbers can never disagree. Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export function useInboxCounts(userId: string | null | undefined): { messages: number; notifications: number; total: number } {
  const messages = useSharedUnreadCount(userId);
  const notifState = useSyncExternalStore(subscribeNotifications, getNotificationSnapshot, getNotificationServerSnapshot);
  // A store still bound to another account (or none) has no count for this one.
  const notifications = userId && notifState.userId === userId ? bellUnreadCount(notifState) : 0;
  return { messages, notifications, total: messages + notifications };
}
