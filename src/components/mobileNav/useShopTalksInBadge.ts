import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { useFeature } from "@/hooks/useFeature";
import { useChromeReadsMayStart } from "@/hooks/usePageReadsSettled";
import { fetchShopTalkSummary, SHOP_TALKS_UNREAD_EVENT } from "@/lib/shops/talkUnread";
import { getNotificationServerSnapshot, getNotificationSnapshot, subscribeNotifications } from "@/components/notificationPanel/notificationStore";
import { stores } from "./navUnreadStore";

/**
 * ONE shop chat read per user and per reason, shared by both navs (the Q103 treatment of the message badge).
 * MobileNav and DesktopSidebarNav both mount on every page and each ran its own read, and the bell's first count
 * (null -> a number) started a second round: prod-audit run 43691657529 (11-15) made 2,895 shops_my_talks calls,
 * 3.0 per signed-in page (980 against 326 feature_switches_for_me in leg 4), the biggest single shape of the run
 * whose busiest minute hit 408 of the 400/min ceiling. A read is keyed by the bell count and the come-back-to-front
 * count; a read started before the bell had counted (`bell` null) also answers the bell's first count.
 */
interface SharedRead { bell: number | null; front: number; promise: Promise<number> }
const reads = new Map<string, SharedRead>();

function sharedShopUnread(userId: string, bell: number | null, front: number): Promise<number> {
  const prev = reads.get(userId);
  if (prev && prev.front === front && (prev.bell === bell || prev.bell === null || bell === null)) {
    if (prev.bell === null) prev.bell = bell;
    return prev.promise;
  }
  const promise = fetchShopTalkSummary().then((s) => s.unread);
  const entry: SharedRead = { bell, front, promise };
  reads.set(userId, entry);
  // A failed read is not kept: the next reason (or the other nav's next render) reads again.
  promise.catch(() => { if (reads.get(userId) === entry) reads.delete(userId); });
  return promise;
}

/** Messages' own fresh count becomes the shared answer, so a nav mounted later does not read again. */
function rememberShopUnread(userId: string, unread: number) {
  const prev = reads.get(userId);
  if (prev) prev.promise = Promise.resolve(unread);
}

// Coming back to the front is counted once for the app, not once per nav, so both navs agree on the reason.
let frontCount = 0;
let frontListening = false;
const frontSubs = new Set<() => void>();
function subscribeFront(cb: () => void) {
  if (!frontListening && typeof document !== "undefined") {
    frontListening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      frontCount += 1;
      for (const f of [...frontSubs]) f();
    });
  }
  frontSubs.add(cb);
  return () => { frontSubs.delete(cb); };
}
const getFront = () => frontCount;
const getFrontServer = () => 0;

/** Test-only reset. Module state outlives a test file otherwise. */
export function __resetShopTalksBadgeReads() { reads.clear(); }

/**
 * S2-016 (Shops audit 2, 11-12): unread shop chats count in the Messages badge, beside unread message threads
 * (the shared store's setShop; useNavUnreadCount fills the message part). Run by the two navs next to
 * useNavUnreadCount. Read only for a member with the shops switch (testers until Shops opens; shops_my_talks refuses
 * without it), after the page's own reads. Read again when the bell's count moves (a new shop message also writes a
 * notice), when the app comes back to the front, and taken straight from Messages whenever its own shop chat read
 * answers (SHOP_TALKS_UNREAD_EVENT, so opening a chat clears it at once). Both navs share one read (sharedShopUnread). No React Query here: the navs mount in
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
  const front = useSyncExternalStore(subscribeFront, getFront, getFrontServer);

  useEffect(() => {
    if (!on || !userId) return;
    const onMessages = (e: Event) => {
      const unread = (e as CustomEvent<{ unread?: unknown }>).detail?.unread;
      if (typeof unread !== "number") return;
      rememberShopUnread(userId, unread);
      setN(unread);
    };
    window.addEventListener(SHOP_TALKS_UNREAD_EVENT, onMessages);
    return () => window.removeEventListener(SHOP_TALKS_UNREAD_EVENT, onMessages);
  }, [on, userId]);

  useEffect(() => {
    if (!on || !userId) return;
    let live = true;
    sharedShopUnread(userId, bellTotal, front).then((unread) => { if (live) setN(unread); }, () => {});
    return () => { live = false; };
  }, [on, userId, bellTotal, front]);

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
