import { report } from "@/lib/errorLogger";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { isArchived, ARCHIVE_CHANGED_EVENT } from "@/lib/archivedConversations";
import { setAppIconBadge } from "@/lib/appBadge";
import { readCachedUnread, writeCachedUnread } from "./mobileNavHelpers";

/**
 * Owns the Messages badge unread count for the bottom nav: the durable-cache
 * seeded state, the live count query, its realtime `messages` subscription + the
 * local archive-changed listener that recompute it, the native app-icon badge
 * mirror, and the best-effort mark-all-read action. Extracted verbatim from
 * MobileNav — hook call order, `useEffect` dep arrays and the query's error
 * handling are unchanged; the realtime binding moved onto the shared user bus.
 */
type UnreadListener = (n: number) => void;

interface UnreadStore {
  count: number;
  listeners: Set<UnreadListener>;
  publish: (n: number) => void;
  close: () => void;
}

/**
 * ONE unread count per user, shared by every nav that shows it (Q103, the
 * Q53 treatment of useActivityBadgeCounts). MobileNav and DesktopSidebarNav
 * both mount on every page, and each ran its own copy of this query and its
 * own realtime channel: 24,549 `messages` requests from CI in 24 h. The store
 * is reference-counted; the last consumer out closes the channel.
 */
const stores = new Map<string, UnreadStore>();

function openStore(userId: string): UnreadStore {
  const store: UnreadStore = {
    count: readCachedUnread(),
    listeners: new Set(),
    publish: (n) => {
      store.count = n;
      store.listeners.forEach((l) => l(n));
    },
    close: () => {},
  };

  const loadCounts = async () => {
    // Mirror the inbox's own hide rules (Messages.tsx) so the badge can't
    // claim "1" while the inbox renders empty: the inbox drops system
    // messages, threads with a blocked sender, AND locally-archived threads,
    // so the count must too. Archived threads are a client-only (safeStorage)
    // concept, so we can't filter them in SQL — we fetch the lightweight
    // unread rows and drop archived ones in JS (LH-54).
    // getBlockedUserIds now THROWS on a failed read rather than returning an
    // empty set, because an empty set reads as "nobody is blocked" and would
    // put blocked people back in the badge. Skip the update instead — a
    // slightly stale count is strictly better than surfacing blocked users.
    let blockedSet: Set<string>;
    try {
      blockedSet = await getBlockedUserIds(userId);
    } catch (err) {
      report(err, { severity: "warning", tags: { source: "useNavUnreadCount.unreadCount" } });
      return;
    }
    const base = supabase
      .from("messages")
      .select("job_id, sender_id, created_at")
      .eq("receiver_id", userId)
      .eq("read", false);
    // `is_system` is a real column but missing from the generated types,
    // so the dynamic .not() filters need an untyped handle.
    let query: any = base;
    query = query.not("is_system", "is", true);
    if (blockedSet.size > 0) {
      query = query.not("sender_id", "in", `(${[...blockedSet].join(",")})`);
    }
    const { data, error } = await query;
    // Only overwrite the seeded value on a successful response —
    // a failed query (offline, transient) must NOT zero the badge
    // and surprise the user. The cache stays the floor.
    if (error) return;
    // Exclude unread messages whose thread the user archived (and that the
    // archive hasn't auto-resurfaced — `isArchived` checks the message's own
    // timestamp against the archive moment, exactly like the inbox). For a
    // received message the other participant is the sender.
    const next = (data ?? []).filter(
      (m: { job_id: string | null; sender_id: string | null; created_at: string }) =>
        !isArchived(userId, m.job_id ?? "", m.sender_id ?? "", m.created_at),
    ).length;
    store.publish(next);
    writeCachedUnread(next);
  };

  loadCounts();

  // Every change to a message I receive recounts. The binding lives on the
  // shared per-user channel (src/lib/userRealtimeBus.ts, topic
  // `messages:inbound`), which the Messages page reads too, so an open inbox
  // no longer doubles the subscription (Q105).
  // A frozen unread badge is the single most misleading stale surface in
  // the app — it is the thing people check INSTEAD of opening Messages —
  // so recount the moment the channel is back.
  const unsubscribe = subscribeUserRealtime(userId, "messages:inbound", () => void loadCounts(), {
    onRecovered: () => void loadCounts(),
  });

  // Archiving/unarchiving a thread changes which unread messages the badge
  // should count, but it's a local action with no `messages` write — so the
  // realtime channel above never fires. Recompute on the archive event too
  // (LH-54).
  const onArchiveChanged = () => loadCounts();
  window.addEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);

  store.close = () => {
    unsubscribe();
    window.removeEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
  };
  return store;
}

export function useNavUnreadCount(user: User | null | undefined) {
  // Seed the badge from the durable cache so a navigation/cold-start
  // without network still paints the last-known count on the first frame —
  // no flicker-to-0 while the live query resolves. The shared store's live
  // query overwrites this on success and also writes back to the cache so
  // the next session is up to date.
  const [unreadCount, setUnreadCount] = useState<number>(() => readCachedUnread());

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let store = stores.get(userId);
    if (!store) {
      store = openStore(userId);
      stores.set(userId, store);
    }
    const s = store;
    const listener: UnreadListener = (n) => setUnreadCount(n);
    s.listeners.add(listener);
    setUnreadCount(s.count);
    return () => {
      s.listeners.delete(listener);
      if (s.listeners.size === 0) {
        s.close();
        if (stores.get(userId) === s) stores.delete(userId);
      }
    };
  }, [user?.id]);

  /** Set the count for every nav showing it (optimistic mark-all-read). */
  const setSharedCount = useCallback((n: number) => {
    const s = user ? stores.get(user.id) : undefined;
    if (s) s.publish(n);
    else setUnreadCount(n);
  }, [user]);

  // Mirror the live unread count onto the native springboard (app-icon)
  // badge, so the home-screen icon carries the unread number like every
  // other messaging app — even while the app is backgrounded. No-op on web
  // and best-effort on native (see setAppIconBadge). A signed-out/guest user
  // has nothing to badge, so force it to zero.
  useEffect(() => {
    void setAppIconBadge(user ? unreadCount : 0);
  }, [user, unreadCount]);

  // Messages — best-effort mark-all-read. Optimistically zero the badge
  // (so the dot disappears in the same frame as the tap); on error the
  // realtime subscription will flip it back when the next live count
  // lands. Doesn't touch individual thread state — we run the same
  // update predicate the inbox uses.
  const markAllRead = useCallback(async () => {
    if (!user) return;
    const prevCount = unreadCount;
    setSharedCount(0);
    writeCachedUnread(0);
    const { error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("receiver_id", user.id)
      .eq("read", false);
    if (error) {
      // Roll the badge back so the user sees the unread state honestly.
      setSharedCount(prevCount);
      writeCachedUnread(prevCount);
      toast.error("Couldn't mark messages read — give it another try.");
      return;
    }
    // Keep the bell in sync with the messages badge: each chat message also
    // spawned a type='message' notifications row, so clear those too or the
    // bell would keep counting messages the user just marked read.
    // This never ran — `void <builder>` discards the thenable without
    // calling then(), so the request was never sent while the UI toasted
    // "All messages marked read."
    void supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("type", "message")
      .eq("read", false)
      .then(({ error }) => {
        if (error) report(error, { tags: { source: "useNavUnreadCount.clearMessageNotifs" } });
      });
  }, [user, unreadCount, setSharedCount]);

  return { unreadCount, markAllRead };
}
