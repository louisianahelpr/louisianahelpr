import { useSyncExternalStore } from "react";
import { useSharedUnreadCount } from "@/components/mobileNav/navUnreadStore";
import { getNotificationServerSnapshot, getNotificationSnapshot, subscribeNotifications } from "./notificationStore";

/**
 * Messages' unread count for a bell that also holds Messages (Declutter's top bar, owner 11-08), 0 for every other
 * bell. READ ONLY: MobileNav fills the shared Messages store on every phone page, as it did for the top bar's own
 * Messages button. The member is the one the notification store is bound to (useNavUnreadCount binds it), so the
 * bell needs no account read of its own.
 */
export function useBellMessagesUnread(on: boolean): number {
  const { userId } = useSyncExternalStore(subscribeNotifications, getNotificationSnapshot, getNotificationServerSnapshot);
  const n = useSharedUnreadCount(on ? userId : null);
  return on ? n : 0;
}
