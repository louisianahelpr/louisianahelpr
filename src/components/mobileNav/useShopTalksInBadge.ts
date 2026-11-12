import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { useFeature } from "@/hooks/useFeature";
import { useChromeReadsMayStart } from "@/hooks/usePageReadsSettled";
import { fetchShopTalkSummary, SHOP_TALKS_UNREAD_EVENT } from "@/lib/shops/talkUnread";
import { getNotificationServerSnapshot, getNotificationSnapshot, subscribeNotifications } from "@/components/notificationPanel/notificationStore";
import { stores } from "./navUnreadStore";

/**
 * S2-016 (Shops audit 2, 11-12): unread shop chats count in the Messages badge, beside unread message threads
 * (the shared store's setShop; useNavUnreadCount fills the message part). Run by the two navs next to
 * useNavUnreadCount. Read only for a member with the shops switch (testers until Shops opens; shops_my_talks refuses
 * without it), after the page's own reads. Read again when the bell's count moves (a new shop message also writes a
 * notice), when the app comes back to the front, and taken straight from Messages whenever its own shop chat read
 * answers (SHOP_TALKS_UNREAD_EVENT, so opening a chat clears it at once). No React Query here: the navs mount in
 * places without a query client. A failed read keeps what the badge had.
 */
export function useShopTalksInBadge(user: User | null | undefined): void {
  const shopsOn = useFeature("shops");
  const mayStart = useChromeReadsMayStart();
  const userId = user?.id;
  const on = !!userId && shopsOn && mayStart;
  const [n, setN] = useState(0);
  const bell = useSyncExternalStore(subscribeNotifications, getNotificationSnapshot, getNotificationServerSnapshot);
  const bellTotal = bell.userId === userId ? bell.unreadTotal : null;
  const [front, setFront] = useState(0);

  useEffect(() => {
    if (!on) return;
    const onVisible = () => { if (document.visibilityState === "visible") setFront((x) => x + 1); };
    const onMessages = (e: Event) => {
      const unread = (e as CustomEvent<{ unread?: unknown }>).detail?.unread;
      if (typeof unread === "number") setN(unread);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SHOP_TALKS_UNREAD_EVENT, onMessages);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SHOP_TALKS_UNREAD_EVENT, onMessages);
    };
  }, [on]);

  useEffect(() => {
    if (!on) return;
    let live = true;
    fetchShopTalkSummary().then((s) => { if (live) setN(s.unread); }, () => {});
    return () => { live = false; };
  }, [on, bellTotal, front]);

  const shown = on ? n : 0;
  useEffect(() => {
    if (!userId) return;
    const s = stores.get(userId);
    if (s) {
      s.setShop(shown);
      return;
    }
    // The store opens in useNavUnreadCount's effect; if this ran first, set it once the store exists.
    const id = setTimeout(() => stores.get(userId)?.setShop(shown), 0);
    return () => clearTimeout(id);
  }, [userId, shown]);
}
