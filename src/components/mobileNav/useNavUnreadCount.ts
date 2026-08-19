import { report } from "@/lib/errorLogger";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { isArchived, ARCHIVE_CHANGED_EVENT } from "@/lib/archivedConversations";
import { setAppIconBadge } from "@/lib/appBadge";
import { readCachedUnread, writeCachedUnread } from "./mobileNavHelpers";

/**
 * Owns the Messages badge unread count for the bottom nav: the durable-cache
 * seeded state, the live count query, its realtime `messages` channel + the
 * local archive-changed listener that recompute it, the native app-icon badge
 * mirror, and the best-effort mark-all-read action. Extracted verbatim from
 * MobileNav — hook call order, `useEffect` dep arrays, the realtime channel's
 * `filter` + `channelNonce()`, and the query's error handling are unchanged.
 */
export function useNavUnreadCount(user: User | null | undefined) {
  // Seed the badge from the durable cache so a navigation/cold-start
  // without network still paints the last-known count on the first frame —
  // no flicker-to-0 while the live query resolves. The live query
  // (loadCounts) overwrites this on success and also writes back to the
  // cache so the next session is up to date.
  const [unreadCount, setUnreadCount] = useState<number>(() => readCachedUnread());

  useEffect(() => {
    if (!user) return;

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
        blockedSet = await getBlockedUserIds(user.id);
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "useNavUnreadCount.unreadCount" } });
        return;
      }
      const base = supabase
        .from("messages")
        .select("job_id, sender_id, created_at")
        .eq("receiver_id", user.id)
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
          !isArchived(user.id, m.job_id ?? "", m.sender_id ?? "", m.created_at),
      ).length;
      setUnreadCount(next);
      writeCachedUnread(next);
    };

    loadCounts();

    const channel = supabase
      // Nonce so a quick remount doesn't collide with the prior channel —
      // Supabase dedupes by name and would silently drop the new sub.
      .channel(`unread-nav-${user.id}-${channelNonce()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` },
        () => loadCounts()
      )
      .subscribe();

    // Archiving/unarchiving a thread changes which unread messages the badge
    // should count, but it's a local action with no `messages` write — so the
    // realtime channel above never fires. Recompute on the archive event too
    // (LH-54).
    const onArchiveChanged = () => loadCounts();
    window.addEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
    };
  }, [user?.id]);

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
    setUnreadCount(0);
    writeCachedUnread(0);
    const { error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("receiver_id", user.id)
      .eq("read", false);
    if (error) {
      // Roll the badge back so the user sees the unread state honestly.
      setUnreadCount(prevCount);
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
    toast.success("All messages marked read.");
  }, [user, unreadCount]);

  return { unreadCount, markAllRead };
}
