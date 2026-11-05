import { useEffect, useId, useRef, useState, useMemo, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { alertNotificationArrival } from "@/components/notificationPanel/arrivalAlert";
import { ensureFreshNotificationFeed, LIST_REUSE_MS, loadNotificationFeed, onFeedRecoveryLoad, onNotificationArrival } from "@/components/notificationPanel/notificationFeed";
import { useReducedMotion } from "@/lib/accessibility";
import { useScreenPanelBand } from "@/components/ui/anchoredPanel";
import { isPushSupported, registerServiceWorker, getPushPermission } from "@/lib/pushNotifications";
import { useRequestPushPermissionOutcome } from "@/lib/nativePush";
import { readPushPermission, pushDeclineNeedsSettingsHint } from "@/lib/pushPermissionNudge";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { report } from "@/lib/errorLogger";
import { unwrapMutation } from "@/lib/mutationResult";
import type { Notification, Filter } from "@/components/notificationPanel/types";
import { groupByDay } from "@/components/notificationPanel/notificationPanelHelpers";
import { useNotificationFaces } from "@/components/notificationPanel/useNotificationFaces";
import { subscribeNotifications, getNotificationSnapshot, getNotificationServerSnapshot, setNotificationUser, setNotifications, setUnreadTotal, bellUnreadCount } from "@/components/notificationPanel/notificationStore";
import { notificationDestination } from "@/components/notificationPanel/notificationDestination";
import { useFramerMotion } from "@/components/notificationPanel/useFramerMotion";
import { raceVisibleDeadline } from "@/lib/visibleDeadline";
import { NotificationPanelView } from "./NotificationPanelView";

/* A load that never answers is a failed load. On a saturated database a
   request can sit open for minutes, and while it did the panel had no answer
   and rendered "Nothing new yet." — so every read is bounded, and running out
   of time takes the same error path as any other failure. */

const LOAD_TIMEOUT_MS = 15_000;
// Visible time only (src/lib/visibleDeadline.ts).
const withLoadTimeout = <T,>(pending: PromiseLike<T>): Promise<T> =>
  raceVisibleDeadline(pending, LOAD_TIMEOUT_MS, "Loading notifications timed out");

function useNotificationPanelModel({ triggerClassName, defaultOpen = false }: { triggerClassName?: string; defaultOpen?: boolean } = {}) { // sizes the bell (Home: 44px); defaultOpen: NotificationBell swapped this in on a tap
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  /* SHARED ACROSS EVERY BELL. This was `useState` here, and `<NotificationPanel />`
     is mounted in four places (DesktopTopNav, AdminTopBar, DashboardTitleBar,
     DashboardHeader) — so each bell kept its own list and its own total and
     they disagreed on screen. See notificationStore for the full note. */
  const { notifications, unreadTotal, listLoaded } = useSyncExternalStore(
    subscribeNotifications,
    getNotificationSnapshot,
    getNotificationServerSnapshot,
  );
  const faces = useNotificationFaces(notifications);
  /* `unreadTotal` (read from the store above) is the TRUE database total, not
     the count within the fetched page. Measured before it existed: the database
     held 76 unread while the badge read 47, because both were derived from a
     `limit(50)` fetch. The bell and the panel agreed with each other — which is
     what stopped them contradicting on screen — but both under-reported
     reality, and did so WORSE the more someone used the app. The most engaged
     users saw the least accurate number.
     It rides on the unread read (`count: "exact"`, Q104): no extra request. */
  const [open, setOpen] = useState(defaultOpen);
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set()); // Q2037: lead rows whose job fold is open
  /* framer-motion is fetched when the panel first opens, never on page load —
     see useFramerMotion for the measured chain this breaks. `null` until the
     chunk arrives; rows render as plain divs with the same box meanwhile. */
  const framer = useFramerMotion(open);
  /* A LEAVING ROW (or day section) COLLAPSES ITS OWN HEIGHT while it fades.
     The panel is content-sized up to its max-height, so its bottom edge is
     wherever the list ends. The old exit only faded + slid the row (opacity,
     y) while it kept its full box in flow; when the exit ended the box was
     removed in ONE frame, the panel's bottom edge jumped up by a whole row
     (measured 2026-09-22 at 375 on prod, Chromium: 582 -> 482 in one frame
     for a two-line row; 71px was reported for a shorter one), and only THEN did the remaining rows' `layout` FLIP slide
     them up from where they had been — ~200ms of an empty gap at the top and
     the bottom row drawn under the "Turn on push notifications" footer.
     Animating height/padding/min-height/border to 0 inside the same 200ms
     means the box shrinks every frame, the rows below follow in normal flow,
     and the panel's edge follows them; at removal there is nothing left to
     jump. When the list is at max height the scroll area absorbs the change
     exactly as before. `overflow: hidden` is set instantly at exit start
     (framer applies non-animatable values immediately) so the row's content
     clips to its shrinking box — it is never on a LIVE row or section, where
     it would break the sticky day header. Reduced motion: fade only, 0ms. */
  const collapseExit = reducedMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        height: 0,
        minHeight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderBottomWidth: 0,
        overflow: "hidden",
      };
  const exitTransition = reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" as const };
  /* The bell itself. `PopoverTrigger asChild` composes its own ref with the
     child's, so passing this to <NotificationTrigger> costs nothing and gives
     `useScreenPanelBand` the element whose header bar decides where the
     panel's top edge lands. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { anchorRef, band } = useScreenPanelBand(open, triggerRef);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  /* UNREAD BY DEFAULT — but only when there IS unread (owner). A notification
     panel is opened to answer "what have I missed", and All buries that under
     everything already seen. Opening a caught-up panel on an empty Unread tab
     would be the opposite mistake, so the default is resolved once from the
     first load rather than hardcoded either way. Same rule the Messages inbox
     and the Activity buckets use. */
  const [filter, setFilter] = useState<Filter | null>(null);
  // Differentiates "fetch failed" from "fetched, but no notifications"
  // — without this flag a failed initial load silently falls through to
  // the "All caught up" empty state, which would wrongly suggest the
  // user has no notifications.
  const [loadError, setLoadError] = useState(false);
  const requestPush = useRequestPushPermissionOutcome();

  // `loadNotifications` is created fresh every render but is CAPTURED once —
  // by the mount effect's setTimeout and by usePullToRefresh. Reading
  // `notifications` directly inside it would therefore always see the empty
  // first-render array, so "do we already have rows on screen?" is read from
  // a ref that tracks the live value instead.
  const notificationsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Same capture problem, same answer: the toast decision below needs to know
  // whether the panel is OPEN at the moment the load fails, not whether it was
  // open on the render that created this closure.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /* EVERY FAILURE SHAPE LANDS HERE (owner report, 2026-09-14: "Nothing new
     yet." for a poster with 313 unread, during the prod outage). The error
     card used to be reachable from one shape only — a resolved `{ error }`.
     A rejected query threw out of the async loader, an errored session read
     (auth goes down with the database) was treated as "signed out", and a hung
     request never answered; all three fell through to the empty state.
     NotificationPanel.failedLoad.test.tsx drives each one. */
  const failLoad = (error: unknown) => {
    console.error("[NotificationPanel] failed to load notifications:", error);
    // Surface to the error logger alongside the local console + toast
    // so the failure shows up in error_logs / Sentry instead of being
    // swallowed into a silent retry loop.
    report(error, { tags: { source: "NotificationPanel.load" } });
    // Only mark the panel as errored when we have no existing rows to
    // show. A background refresh failure with prior data on screen
    // stays silent so a transient hiccup doesn't blow away a list the
    // user is mid-reading.
    // The badge load's unread rows are not a list on screen (Q104): until the list loads, this is the error card.
    const hasRowsOnScreen = getNotificationSnapshot().listLoaded && notificationsRef.current.length > 0;
    setLoadError((prev) => (hasRowsOnScreen ? prev : true));
    // ONE OUTAGE, ONE MESSAGE.
    //
    // This toast used to fire on EVERY failed load, including the one that
    // runs 800ms after any authed page mounts with the panel shut. So a
    // single backend outage on /home produced two messages for the same
    // event: the page's own error card, and — floating over it for the four
    // seconds a sonner toast lives — "Couldn't load notifications — try
    // again?", about a panel the user had not opened and could not see.
    // Measured at 375 with every non-account read 500ing: the toast was on
    // screen alongside the page's error card from t=1.5s to ~t=5s.
    //
    // The panel already owns a designed failure state — the inline
    // "Couldn't load notifications. / Our end had a hiccup — not yours."
    // card with its own Try again button, rendered from `loadError` below.
    // That is the right place for this news, because it is where the user
    // goes to act on it. So the toast is now reserved for the single case
    // that card cannot cover: the panel is OPEN and already showing rows, so
    // `loadError` is deliberately suppressed (a background hiccup must not
    // blow away a list mid-read) and nothing else on screen would say the
    // refresh failed.
    //
    // Closed panel → no message here; the page's own error state speaks, and
    // the inline card is waiting when the user opens the bell.
    if (openRef.current && hasRowsOnScreen) {
      toast.error("Couldn't load notifications — try again?");
    }
  };

  const loadNotifications = async (force = true) => {
    try {
      await loadNotificationsOnce(force);
    } catch (err) {
      failLoad(err);
    }
  };

  const loadNotificationsOnce = async (force: boolean) => {
    const { data: { session }, error: sessionError } = await withLoadTimeout(supabase.auth.getSession());
    // An errored session read is NOT "signed out": in an outage the token
    // refresh fails and auth-js answers `{ session: null, error }`. Clearing
    // the store here would render the empty state for someone who has rows.
    if (sessionError) throw sessionError;
    if (!session?.user) {
      // Signed out — drop the shared state so the next account cannot inherit
      // this one's list or its unread count.
      setNotificationUser(null);
      return;
    }
    // The list load (recency + unread page) is the shared feed's (Q756); it THROWS on a failure (the error card).
    await (force ? loadNotificationFeed(session.user.id) : ensureFreshNotificationFeed(session.user.id, LIST_REUSE_MS)); // an open reuses a fresh list, e.g. the hover prefetch (Q1183, Q104)
    setLoadError(false);
  };

  // Pull-to-refresh on the notification list — manual recovery path
  // for the realtime subscription. Scoped to the inner scroll area
  // via PullToRefreshWrapper below.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { await loadNotifications(); },
  });

  // The list loads when the panel opens (or on the bell's hover/focus/touch), never on mount: the badge
  // needs only the feed's unread page (Q104, lead 2026-11-02). A fresh list (LIST_REUSE_MS) is reused.
  useEffect(() => { if (open) void loadNotifications(false); }, [open]);

  useEffect(() => {

    // Check push support
    const supported = isPushSupported();
    setPushSupported(supported);
    if (supported) {
      setPushEnabled(getPushPermission() === "granted");
      registerServiceWorker();
    }

    // The realtime binding and the store updates live in the bell's shared
    // feed (Q756), bound for every signed-in user on every route by
    // useNavUnreadCount. A mounted panel only adds the chime and the local
    // notification for each new row.
    // A realtime reconnect reloads through the feed: surface its outcome
    // exactly like a load this panel ran (error card / toast, or clear it).
    const offRecovery = onFeedRecoveryLoad((err) => {
      if (err) failLoad(err);
      else setLoadError(false);
    });
    const off = onNotificationArrival(alertNotificationArrival);

    return () => {
      off();
      offRecovery();
    };
  }, []);

  const enablePush = async () => {
    // Routes through usePermissionRationale → rationale dialog first,
    // then the actual OS prompt. Keeps web parity with the native side
    // and matches the dashboard PushNotificationPrompt UX.
    const outcome = await requestPush();
    if (outcome === "granted") {
      setPushEnabled(true);
    } else if (outcome === "refused" && pushDeclineNeedsSettingsHint(await readPushPermission())) {
      // Never after "Not now" in our rationale dialog ("dismissed"): they just chose it.
      toast.error(
        Capacitor.isNativePlatform()
          ? "Notifications are off. Turn them on in your device settings."
          : "Notifications are off. Turn them on in your browser settings.",
      );
    }
  };

  /* READ STATE — one source, so the bell and the panel cannot disagree.
     `unreadCount` is derived from the SAME `notifications` array the list
     renders, and it feeds both the bell badge and the Unread segment. There
     is no second query, no cached count, and nothing that can drift.

     Opening the panel deliberately does NOT mark anything read. `read` is a
     per-row boolean on `public.notifications` (see the table DDL) and it is
     what drives the badge, the Unread filter, and the sienna row tint — if
     merely opening the panel cleared it, the badge would zero before the user
     had looked at anything and "what have I missed" would be unanswerable on
     the next open. Read is claimed explicitly: opening a row (which is also
     how you act on it) or the Mark-all-read control. */
  const unreadInPage = notifications.filter((n) => !n.read).length;
  // Prefer the counted total; fall back to the page while it is still loading
  // or if the count query failed. Never show a number derived from an error.
  const unreadCount = bellUnreadCount({ notifications, unreadTotal });
  // The list can only ever show what it fetched. Saying so is the honest
  // alternative to quietly shrinking the badge to match the page.
  const hasMoreThanPage = unreadTotal !== null && unreadTotal > unreadInPage;
  // Seed the default from the first rows, once (the badge's unread page counts: unread exists).
  // `null` = "not chosen yet", so an empty first render does not lock the panel to All.
  useEffect(() => {
    if (filter !== null || notifications.length === 0) return;
    setFilter(notifications.some((n) => !n.read) ? "unread" : "all");
  }, [notifications, filter]);

  // Before the list loads the store holds the badge's unread page (Q104): complete for Unread, never shown as All.
  const listShowable = listLoaded || (filter === "unread" && notifications.length > 0);
  const visibleNotifications = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filter],
  );
  const groupedNotifications = useMemo(
    () => groupByDay(visibleNotifications),
    [visibleNotifications],
  );

  const markAsRead = async (id: string) => {
    // Already read on the client — nothing to write, and firing the UPDATE
    // anyway would make every re-open of an old notification a pointless
    // round-trip.
    if (notifications.find((n) => n.id === id)?.read) return;
    // Optimistic flip first so the row responds instantly; revert on failure
    // so the badge doesn't lie about what the server thinks is unread.
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    // Keep the badge's own number in step with the row. `unreadTotal` is the
    // TRUE database total and it wins over the page-derived count (see
    // `unreadCount` below), so leaving it alone here left the bell reporting a
    // number the visible list contradicted — the owner saw the bell on 10
    // beside a panel saying 11. Clamped at 0 so a double-tap cannot drive it
    // negative.
    setUnreadTotal((t) => (t === null ? t : Math.max(0, t - 1)));
    try {
      // `.select("id")` + unwrapMutation is the CLAUDE.md row guard: RLS on
      // `notifications` is `auth.uid() = user_id`, so a row that isn't ours
      // (or has been deleted) comes back `{ data: [], error: null }` — a
      // silent no-op that would leave the bell badge permanently one lower
      // than the database. Zero rows is a failure here, not a valid outcome.
      unwrapMutation(
        await supabase.from("notifications").update({ read: true }).eq("id", id).select("id"),
        { action: "mark this notification read", context: { notificationId: id } },
      );
    } catch (err) {
      report(err, { tags: { source: "NotificationPanel.markAsRead" } });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: false } : n));
      // Roll the total back with the row — a failed write must not leave the
      // badge one lower than the database, which is the same lie in the
      // opposite direction.
      setUnreadTotal((t) => (t === null ? t : t + 1));
    }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    // Optimistically clear unread state so the UI responds immediately.
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // NOT zero — `unreadIds` covers only the 50 rows this panel fetched, and
    // `unreadTotal` is the whole database. On an account with more unread than
    // one page (the case the count query exists for at all) setting 0 here
    // would clear a badge that still has real unread behind it. Subtract what
    // was actually marked.
    setUnreadTotal((t) => (t === null ? t : Math.max(0, t - unreadIds.length)));
    try {
      // Every id must come back. A short result means some rows were filtered
      // out by RLS or no longer exist, and the badge would otherwise sit at 0
      // while the database still holds unread rows.
      unwrapMutation(
        await supabase.from("notifications").update({ read: true }).in("id", unreadIds).select("id"),
        {
          action: "mark your notifications read",
          min: unreadIds.length,
          rejectedMessage: "Couldn't mark all as read — please try again.",
        },
      );
    } catch (err) {
      report(err, { tags: { source: "NotificationPanel.markAllRead" } });
      // Roll back the optimistic update and let the user retry.
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: false } : n)),
      );
      setUnreadTotal((t) => (t === null ? t : t + unreadIds.length));
      toast.error("Couldn't mark all as read — please try again.");
      return;
    }
    hapticLight();
  };

  /* Does this row have somewhere to go, and WHERE?
     Resolved through notificationDestination(), which prefers the `job_id`
     REFERENCE over parsing `link` — see that file for why the string was never
     trustworthy. Rows with no job_id (everything written before
     20260901035600, and anything whose job was later deleted) fall back to the
     link exactly as before. A null result is a real state: 6 rows in prod
     carry `link: null` ("Test from Helpr", "Application declined"). */
  const destinationOf = (n: Notification): string | null => notificationDestination(n);
  const hasDestination = (n: Notification): boolean => destinationOf(n) !== null;

  /* Is there anything a tap on this row can DO?
     Two things can happen on tap: navigate, and mark read. A row with no link
     that is already read offers neither — every previous render still gave it
     `role="button"`, `cursor-pointer` and `active:opacity-80`, so it looked
     like a control, absorbed a tap, and returned nothing. That is a small lie
     the user pays for with a tap, and it repeats every time they scroll past.
     An UNREAD row without a link is genuinely actionable: tapping clears the
     dot and repaints the row, which is a visible result and an honest one. So
     the affordance is shown exactly when a tap has an effect. */
  const isActionable = (n: Notification): boolean => hasDestination(n) || !n.read;

  const handleClick = (n: Notification) => {
    void markAsRead(n.id);
    // A notification exists to take you somewhere — follow its destination
    // when it has one. Anything absent or malformed just marks read and keeps
    // the panel open.
    const to = destinationOf(n);
    if (to) {
      // Navigate first, close a frame later — closing synchronously in the
      // same tick as the route change reads as one jarring instant unmount
      // stacked on top of the page transition.
      navigate(to);
      requestAnimationFrame(() => setOpen(false));
    }
  };

  const showPushRow = pushSupported && !pushEnabled;

  return {
    anchorRef,
    band,
    canTrigger,
    collapseExit,
    containerRef,
    destinationOf,
    enablePush,
    exitTransition,
    faces,
    filter,
    framer,
    groupedNotifications,
    handleClick,
    hasMoreThanPage,
    isActionable,
    isPulling,
    listShowable,
    loadError,
    loadNotifications,
    markAllRead,
    markAsRead,
    navigate,
    notifications,
    open,
    openFolds,
    pullDistance,
    reducedMotion,
    refreshing,
    setFilter,
    setOpen,
    setOpenFolds,
    showPushRow,
    titleId,
    triggerClassName,
    triggerRef,
    unreadCount,
    unreadTotal,
    visibleNotifications,
  };
}

/** What the bell and its panel view read (Q806: the JSX lives in ./NotificationPanelView; this file keeps the state, reads and handlers). */
export type NotificationPanelModel = ReturnType<typeof useNotificationPanelModel>;

const NotificationPanel = (props: Parameters<typeof useNotificationPanelModel>[0] = {}) => {
  const m = useNotificationPanelModel(props);
  return <NotificationPanelView {...m} />;
};

export default NotificationPanel;
