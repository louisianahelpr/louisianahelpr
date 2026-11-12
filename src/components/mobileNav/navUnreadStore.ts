import { useState, useSyncExternalStore } from "react";
import { readCachedUnread } from "./mobileNavHelpers";

/**
 * The shared Messages unread stores (Q103), apart from the hook that fills them (useNavUnreadCount: the live query,
 * the realtime channel, the archive listener), so a control that only SHOWS the count can read it without pulling
 * the query's code into its chunk or opening a store of its own. Since the nav redesign (owner 2026-11-06) the
 * phone's Messages button is in the top bar (AppTopBar), on Home's first screen; MobileNav, mounted on every phone
 * page with that bar, keeps the store filled. Guard: src/test/homeSkipsOtherScreensCode.test.ts.
 */
export type UnreadListener = (n: number) => void;

export interface UnreadStore {
  /** What the badge shows: unread message threads plus unread shop chats (S2-016). */
  count: number;
  /** The unread message threads alone (publish sets it; mark-all-read rolls back to it). */
  messages: number;
  listeners: Set<UnreadListener>;
  /** Set the unread MESSAGE threads; the shop chats part is kept. */
  publish: (n: number) => void;
  /** S2-016: set the unread shop chats (0 while the member has no Shops). */
  setShop: (n: number) => void;
  close: () => void;
}

export const stores = new Map<string, UnreadStore>();

const watchers = new Set<() => void>();

/** Tell every read-only watcher a store's count (or the set of stores) changed. */
export function notifyUnreadWatchers() {
  for (const w of watchers) w();
}

function subscribe(w: () => void) {
  watchers.add(w);
  return () => watchers.delete(w);
}

/** The user's unread count as the shared store holds it; the durable cache until a store has a count. */
export function useSharedUnreadCount(userId: string | null | undefined): number {
  const [cached] = useState(() => readCachedUnread(userId));
  const live = useSyncExternalStore(
    subscribe,
    () => (userId ? stores.get(userId)?.count ?? -1 : -1),
    () => -1,
  );
  return live >= 0 ? live : cached;
}
