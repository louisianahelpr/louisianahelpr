import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { report } from "@/lib/errorLogger";
import type { Notification } from "./types";
import {
  getNotificationSnapshot,
  setNotificationUser,
  setNotifications,
  setUnreadTotal,
  markNotificationsLoaded,
} from "./notificationStore";

/**
 * THE BELL'S FEED, BOUND FOR EVERY SIGNED-IN USER ON EVERY ROUTE (Q756).
 *
 * The load (recency page + unread page + head count) and the realtime
 * `notifications` INSERT binding used to live inside `<NotificationPanel />`.
 * On a phone only DashboardTitleBar mounts a bell, so a cold launch into any
 * other page (a push tap into /messages) left the store unbound, and leaving
 * the dashboard froze it: the app-icon badge (useNavUnreadCount, N-006) could
 * not follow the bell. The feed is now opened by `useNotificationFeed`, which
 * useNavUnreadCount calls, and MobileNav runs that hook on every route before
 * any early return. The panel only renders the store and offers pull-to-refresh.
 *
 * One feed per user, reference-counted (MobileNav + DesktopSidebarNav both
 * mount it): exactly one `notifications:insert` binding however many bells or
 * navs are on screen.
 */

const LOAD_TIMEOUT_MS = 15_000;
const withLoadTimeout = <T,>(pending: PromiseLike<T>): Promise<T> =>
  Promise.race([
    Promise.resolve(pending),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`notifications load timed out after ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS),
    ),
  ]);

let inFlight: { userId: string; promise: Promise<void> } | null = null;

/**
 * Load the bell's list and its true unread total into the shared store for
 * `userId`. THROWS on a failed list load (the panel turns that into its error
 * card; the feed reports it). A failed head count leaves `unreadTotal` null so
 * the bell falls back to the page, never to a number invented from an error.
 * Concurrent calls for the same user share one request.
 */
export const loadNotificationFeed = (userId: string): Promise<void> => {
  if (inFlight?.userId === userId) return inFlight.promise;
  const promise = loadOnce(userId).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { userId, promise };
  return promise;
};

/** Tests only: forget a load left in flight by a previous test's fake clock. */
export const __resetNotificationFeedLoad = () => { inFlight = null; };

const stillBound = (userId: string) => getNotificationSnapshot().userId === userId;

const loadOnce = async (userId: string) => {
  // No-op while the same person stays signed in; clears everything the
  // moment the id changes.
  setNotificationUser(userId);
  /* TWO SELECTS, NOT ONE: the recency page ("All") can miss every unread row
     (measured 2026-09-11: 10 unread ranked 53rd-62nd), so a second
     unread-scoped select guarantees they are present whenever there are at
     most 50. Merge, dedupe by id, re-sort. */
  const [recent, unread] = await withLoadTimeout(Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(50),
  ]));
  // Either failing is a failed load: a recency page without its unread rows
  // is the defect above, and unread rows without the page is not a list.
  const error = recent.error ?? unread.error;
  if (error) throw error;
  // Signed out or switched account while the request was out: these rows
  // belong to nobody on screen now.
  if (!stillBound(userId)) return;
  const data = [...new Map(
    [...(recent.data ?? []), ...(unread.data ?? [])].map((n) => [n.id, n]),
  ).values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  setNotifications(data as Notification[]);
  markNotificationsLoaded();

  // Counted separately and deliberately: the list is a page, the badge is a
  // fact. A failure here leaves unreadTotal null and the UI falls back to
  // the page-derived count.
  const { count, error: countErr } = await withLoadTimeout(supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false));
  if (countErr) {
    report(countErr, { tags: { source: "NotificationPanel.unreadCount" } });
    return;
  }
  if (!stillBound(userId)) return;
  setUnreadTotal(count ?? 0);
};

/** Side effects a mounted bell adds to a live arrival (chime, local push). */
type ArrivalListener = (n: Notification) => void;
const arrivalListeners = new Set<ArrivalListener>();
export const onNotificationArrival = (l: ArrivalListener) => {
  arrivalListeners.add(l);
  return () => { arrivalListeners.delete(l); };
};

/**
 * Result of the reload a realtime reconnect triggers: `null` = it worked,
 * otherwise the error. A mounted panel listens so a failed reconnect reload
 * shows its error card/toast and a good one clears a stale error card, as
 * they did when the panel owned the channel.
 */
type RecoveryListener = (err: unknown) => void;
const recoveryListeners = new Set<RecoveryListener>();
export const onFeedRecoveryLoad = (l: RecoveryListener) => {
  recoveryListeners.add(l);
  return () => { recoveryListeners.delete(l); };
};

type Feed = { refs: number; close: () => void };
const feeds = new Map<string, Feed>();

const INITIAL_LOAD_DELAY_MS = 800;

function openFeed(userId: string): Feed {
  setNotificationUser(userId);
  const load = () =>
    loadNotificationFeed(userId).catch((err) =>
      report(err, { tags: { source: "notificationFeed.load" } }),
    );
  // Deferred so the first paint is not competing with it (same delay the
  // panel always used).
  const timer = setTimeout(() => void load(), INITIAL_LOAD_DELAY_MS);
  // The binding (notifications INSERT, user_id=eq.<me>) lives on the ONE
  // shared per-user channel (src/lib/userRealtimeBus.ts, Q105).
  const unsubscribe = subscribeUserRealtime(
    userId,
    "notifications:insert",
    (payload) => {
      if (!stillBound(userId)) return;
      const n = payload.new as Notification;
      let added = false;
      // A realtime INSERT can race the initial fetch (both carry the row), so
      // dedupe on id; the total moves inside the dedupe branch so a row that
      // arrives twice counts once.
      setNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        added = true;
        return [n, ...prev];
      });
      if (!added) return;
      if (!n.read) setUnreadTotal((t) => (t === null ? t : t + 1));
      for (const l of [...arrivalListeners]) l(n);
    },
    {
      // This channel is the bell's only live feed. A drop leaves the badge
      // frozen on a count that is no longer true, so re-read the list rather
      // than resuming from whatever arrives next.
      onRecovered: () =>
        void loadNotificationFeed(userId).then(
          () => { for (const l of [...recoveryListeners]) l(null); },
          (err) => {
            // A mounted panel turns this into its error card / toast (and
            // reports it); with no panel, the feed reports it itself.
            if (recoveryListeners.size === 0) report(err, { tags: { source: "notificationFeed.load" } });
            for (const l of [...recoveryListeners]) l(err);
          },
        ),
    },
  );
  return {
    refs: 0,
    close: () => {
      clearTimeout(timer);
      unsubscribe();
      // Last consumer out = signed out (or the app unmounted): drop this
      // person's list and count so the next account cannot inherit them.
      if (stillBound(userId)) setNotificationUser(null);
    },
  };
}

/**
 * Keep the bell's store loaded and live for `userId`. Called by
 * useNavUnreadCount, which MobileNav runs on every route; safe to call from
 * any number of components (one feed per user).
 */
export function useNotificationFeed(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;
    let feed = feeds.get(userId);
    if (!feed) {
      feed = openFeed(userId);
      feeds.set(userId, feed);
    }
    const f = feed;
    f.refs += 1;
    return () => {
      f.refs -= 1;
      if (f.refs === 0) {
        f.close();
        if (feeds.get(userId) === f) feeds.delete(userId);
      }
    };
  }, [userId]);
}
