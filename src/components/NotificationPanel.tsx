import { useEffect, useId, useRef, useState, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { useReducedMotion } from "@/lib/accessibility";
import { AlertTriangle, BellRing, CheckCheck } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverAnchor,
  PopoverDismissLayer,
} from "@/components/ui/popover";
import {
  AnchoredPanelHeader,
  AnchoredPanelSegmented,
  screenPanelContentClass,
  screenPanelContentProps,
  useScreenPanelBand,
} from "@/components/ui/anchoredPanel";
import { isPushSupported, registerServiceWorker, showLocalNotification, getPushPermission } from "@/lib/pushNotifications";
import { useRequestPushPermission } from "@/lib/nativePush";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { report } from "@/lib/errorLogger";
import { unwrapMutation } from "@/lib/mutationResult";
import type { Notification, Filter } from "@/components/notificationPanel/types";
import { typeIcons, groupByDay, timeAgo } from "@/components/notificationPanel/notificationPanelHelpers";
import { NotificationTrigger } from "@/components/notificationPanel/NotificationTrigger";

const NotificationPanel = () => {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  /* The TRUE unread total, not the count within the fetched page.
     Measured before this existed: the database held 76 unread while the badge
     read 47, because both were derived from a `limit(50)` fetch. The bell and
     the panel agreed with each other — which is what stopped them
     contradicting on screen — but both under-reported reality, and did so
     WORSE the more someone used the app. The most engaged users saw the least
     accurate number.
     `head: true` returns no rows, and the (user_id, read) index already exists
     for exactly this shape, so it costs a count and no payload. */
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
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
  const requestPush = useRequestPushPermission();

  // `loadNotifications` is created fresh every render but is CAPTURED once —
  // by the mount effect's setTimeout and by usePullToRefresh. Reading
  // `notifications` directly inside it would therefore always see the empty
  // first-render array, so "do we already have rows on screen?" is read from
  // a ref that tracks the live value instead.
  const notificationsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const loadNotifications = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[NotificationPanel] failed to load notifications:", error);
      // Surface to the error logger alongside the local console + toast
      // so the failure shows up in error_logs / Sentry instead of being
      // swallowed into a silent retry loop.
      report(error, { tags: { source: "NotificationPanel.load" } });
      // Only mark the panel as errored when we have no existing rows to
      // show. A background refresh failure with prior data on screen
      // stays silent so a transient hiccup doesn't blow away a list the
      // user is mid-reading.
      setLoadError((prev) => (notificationsRef.current.length === 0 ? true : prev));
      toast.error("Couldn't load notifications — try again?");
      return;
    }
    setLoadError(false);
    if (data) setNotifications(data);

    // Counted separately and deliberately: the list is a page, the badge is a
    // fact. A failure here leaves unreadTotal null and the UI falls back to
    // the page-derived count — stale, but never a number invented from an
    // error path.
    const { count, error: countErr } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("read", false);
    if (countErr) {
      report(countErr, { tags: { source: "NotificationPanel.unreadCount" } });
      return;
    }
    setUnreadTotal(count ?? 0);
  };

  // Pull-to-refresh on the notification list — manual recovery path
  // for the realtime subscription. Scoped to the inner scroll area
  // via PullToRefreshWrapper below.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { await loadNotifications(); },
  });

  useEffect(() => {
    // Defer initial notification load to avoid blocking page render
    const timer = setTimeout(() => loadNotifications(), 800);

    // Check push support
    const supported = isPushSupported();
    setPushSupported(supported);
    if (supported) {
      setPushEnabled(getPushPermission() === "granted");
      registerServiceWorker();
    }

    // Realtime subscription — also trigger browser push for new notifications.
    // We resolve the userId upfront so we can pass a server-side filter,
    // scoping the postgres_changes subscription to only this user's rows
    // (avoids receiving every platform-wide notification INSERT).
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // The session read is async — if the component unmounts before it
    // resolves, the cleanup below has already run against a null `channel`
    // and the subscription would leak. The flag closes that race.
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const userId = session?.user?.id;
      if (!userId || cancelled) return;
      channel = supabase
        // Unique per mount — NotificationPanel renders in both the header
        // and the admin shell, and a shared channel name would collide.
        .channel(`notifications-realtime-${channelNonce()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          async (payload) => {
            const n = payload.new as Notification;
            // A realtime INSERT can race the initial fetch (both can carry the
            // same row), and React would then render two elements with the same
            // key. Dedupe on id — the badge count is derived from this list, so
            // a duplicate would also overcount unread.
            setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
            // Play notification chime + vibrate
            try {
              const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.setValueAtTime(830, ctx.currentTime);
              osc.frequency.setValueAtTime(990, ctx.currentTime + 0.1);
              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.3);
              // Browsers cap concurrent AudioContexts (~6); without this
              // the chime silently stops firing after a handful of
              // notifications. Release it once the tone finishes.
              osc.onended = () => { ctx.close().catch(() => {}); };
            } catch {}
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            if (document.hidden && getPushPermission() === "granted") {
              showLocalNotification(n.title, n.message, n.link || undefined);
            }
          },
        )
        .subscribe();
      // Unmounted while subscribe was in flight — tear it down right away.
      if (cancelled) {
        supabase.removeChannel(channel);
        channel = null;
      }
    });

    return () => {
      clearTimeout(timer);
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const enablePush = async () => {
    // Routes through usePermissionRationale → rationale dialog first,
    // then the actual OS prompt. Keeps web parity with the native side
    // and matches the dashboard PushNotificationPrompt UX.
    const granted = await requestPush();
    if (granted) {
      setPushEnabled(true);
    } else {
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
  const unreadCount = unreadTotal ?? unreadInPage;
  // The list can only ever show what it fetched. Saying so is the honest
  // alternative to quietly shrinking the badge to match the page.
  const hasMoreThanPage = unreadTotal !== null && unreadTotal > unreadInPage;
  // Seed the default from the first loaded page, once. `null` means "not chosen
  // yet" so the very first render — when `notifications` is still empty — does
  // not lock the panel to All.
  useEffect(() => {
    if (filter !== null || notifications.length === 0) return;
    setFilter(notifications.some((n) => !n.read) ? "unread" : "all");
  }, [notifications, filter]);

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
    }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    // Optimistically clear unread state so the UI responds immediately.
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
      toast.error("Couldn't mark all as read — please try again.");
      return;
    }
    hapticLight();
  };

  /* Does this row have somewhere to go?
     Only a root-relative path is navigable in-app; a null link, an absolute
     URL and a `javascript:` string are all equally un-followable. 6 rows in
     prod today carry `link: null` ("Test from Helpr", "Application declined"). */
  const hasDestination = (n: Notification): n is Notification & { link: string } =>
    typeof n.link === "string" && n.link.startsWith("/");

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
    // A notification exists to take you somewhere — follow its link when it
    // has one. Only in-app (root-relative) links are navigable; anything
    // absent or malformed just marks read and keeps the panel open.
    if (hasDestination(n)) {
      // Navigate first, close a frame later — closing synchronously in the
      // same tick as the route change reads as one jarring instant unmount
      // stacked on top of the page transition.
      navigate(n.link);
      requestAnimationFrame(() => setOpen(false));
    }
  };

  const showPushRow = pushSupported && !pushEnabled;

  return (
    /* `modal` is load-bearing, not decoration — and it is KEPT even though the
       scrim is gone. It is what locks the page (so the FEED can't scroll under
       an open panel — the panel's own list is the only thing that moves),
       traps focus inside the panel, and returns focus to the bell on close.
       None of those were the scrim's doing. Dismissal is still tap-outside /
       Escape via Radix's DismissableLayer, plus the explicit X in the header
       for touch. */
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <NotificationTrigger ref={triggerRef} unreadCount={unreadCount} />
      </PopoverTrigger>
      {/* The panel is positioned against a measured SCREEN BAND, not against
          the bell: a zero-height rect spanning the viewport at the bottom edge
          of the header the bell sits in. The trigger still opens it; the band
          is what decides where it lands. See `useScreenPanelBand`. */}
      <PopoverAnchor virtualRef={anchorRef} />
      {/* NO SCRIM — the page behind is neither dimmed nor blurred (owner,
          2026-08-31: "Same for this. No blur"). What is still mounted is a
          layer that PAINTS NOTHING and exists only to receive the tap that
          dismisses the panel: without it, Radix's deferred outside-dismiss
          lets the very same click land on the job card underneath and open it.
          See `PopoverDismissLayer` in `ui/popover.tsx`. Its own portal, placed
          before the Content's, the way `SheetPortal` stacks `SheetOverlay`
          under `SheetContent`. */}
      <PopoverPortal>
        <PopoverDismissLayer />
      </PopoverPortal>
      <PopoverContent
        {...screenPanelContentProps(band)}
        aria-labelledby={titleId}
        className={screenPanelContentClass}
        // Park focus on the PANEL, not on its first focusable child. Radix's
        // default would land on "Mark all as read", so opening the panel and
        // pressing Enter — or a screen reader's first move — would silently
        // clear every unread notification. Focusing the container instead
        // announces the panel, starts Tab inside it, and arms nothing. Same
        // fix, same reason, as DialogContent's onOpenAutoFocus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        {/* No caret. The panel spans the screen, so there is no edge for a
            notch to point back at the bell from (owner: "it should be anchored
            to screen").

            The wrapper below is the flex column that holds header + list +
            footer. Its children are left at the outer indent level on purpose:
            re-indenting the whole panel would bury the real change in a
            200-line whitespace diff.

            `mx-auto max-w-lg` is a CONTENT measure, not a side margin: the
            SURFACE still runs edge to edge (that is the whole point of a
            screen-anchored band), but the rows inside it stop at the app's
            shared popup measure. Without it the Unread/All segmented control
            stretched to 1440px on the desktop website — one pill the width of
            the window, which is not a control anyone reads as a control.
            Below 512px, which is every phone the owner reviewed this on, the
            measure is wider than the screen and changes nothing. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full max-w-lg mx-auto">
        <AnchoredPanelHeader
          titleId={titleId}
          title="Notifications"
          onClose={() => setOpen(false)}
          actions={
            unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                aria-label="Mark all as read"
                title="Mark all as read"
                className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full transition-colors hover:bg-[hsl(var(--bark)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] focus-visible:ring-offset-1"
                style={{ color: "hsl(var(--bark))" }}
              >
                <CheckCheck className="w-[18px] h-[18px]" strokeWidth={2.25} />
              </button>
            ) : undefined
          }
        >
          {/* ONE control, two segments — not a bare word beside a filled
              circle. The count rides the Unread segment so it says exactly
              what the bell badge said a moment ago; All carries no count
              because the fetch caps at 50 rows, and a capped number here
              would be a figure the panel can't stand behind. */}
          <AnchoredPanelSegmented<Filter>
            label="Filter notifications"
            value={filter ?? "all"}
            onChange={(v) => { hapticLight(); setFilter(v); }}
            options={[
              { key: "unread", label: "Unread", count: unreadCount },
              { key: "all", label: "All" },
            ]}
          />
        </AnchoredPanelHeader>

        <PullToRefreshWrapper
          ref={containerRef}
          pullDistance={pullDistance}
          refreshing={refreshing}
          isPulling={isPulling}
          canTrigger={canTrigger}
          className="flex-1 min-h-0 no-scrollbar overscroll-contain"
        >
          {loadError && notifications.length === 0 ? (
            /* A failed initial load takes precedence over the "All caught up"
               empty state — the user must be able to tell "nothing happened"
               from "we couldn't ask".

               Deliberately NOT `<ErrorState>`: that primitive is a full
               frosted card (a ~100px glyph, an eyebrow, a headline and a
               wrapped body) sized for a whole page, and inside a ~450px
               dropdown it overflowed the scroll area — pushing "Try again",
               the one thing this state exists to offer, below the fold.
               Same scale defect the empty state above had. This mirrors that
               empty state's compact shape instead, so the recovery action is
               always visible without scrolling. */
            <div className="px-6 py-7 flex flex-col items-center text-center gap-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.10)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2} />
              </div>
              <p
                className="font-display italic font-bold leading-tight text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              >
                Couldn't load notifications.
              </p>
              <p
                className="font-serif italic text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Our end had a hiccup — not yours.
              </p>
              <button
                type="button"
                onClick={loadNotifications}
                className="mt-1 h-11 px-5 rounded-full btn-grad-primary text-ds-12 font-sans font-semibold"
                style={{ color: "hsl(var(--parchment))", boxShadow: "var(--elev-bark-raised)" }}
              >
                Try again
              </button>
            </div>
          ) : visibleNotifications.length === 0 ? (
            /* COMPACT empty state (owner, 2026-08-30: the old one — an 80px
               circled glyph, an eyebrow, a display headline and two lines of
               italic copy, vertically centred in a `min-h-full` box — was the
               biggest thing on screen for the case where there is nothing to
               show). A panel with nothing in it should take the space of
               nothing: one small glyph, one line, one optional way out. */
            <div className="px-6 py-7 flex flex-col items-center text-center gap-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--bark) / 0.08)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                }}
              >
                <CheckCheck className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={2} />
              </div>
              <p
                className="font-display italic font-bold leading-tight text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              >
                {filter === "unread" && notifications.length > 0
                  ? "Nothing unread."
                  : "Nothing new yet."}
              </p>
              <p
                className="font-serif italic text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {filter === "unread" && notifications.length > 0
                  ? "Switch to All to see everything."
                  : "Applications, messages and payouts land here."}
              </p>
            </div>
          ) : (
            <div>
              {groupedNotifications.map((group) => (
                <section key={group.key}>
                  <div
                    className="sticky top-0 z-10 px-4 py-1.5 flex items-center justify-between font-serif italic uppercase tracking-[0.18em] text-ds-10"
                    style={{
                      color: "hsl(var(--burnt-sienna))",
                      background:
                        "linear-gradient(to bottom, hsl(var(--surface-band) / 0.92), hsl(var(--surface-band) / 0.78))",
                      backdropFilter: "blur(8px) saturate(140%)",
                      WebkitBackdropFilter: "blur(8px) saturate(140%)",
                      borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <span>{group.label}</span>
                    <span
                      className="tabular-nums font-sans not-italic font-semibold"
                      style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.04em" }}
                    >
                      {group.items.length}
                    </span>
                  </div>
                  {/* AnimatePresence with initial={false} — only NEW
                      notifications animate in (realtime arrivals slide
                      down + fade). The first render of the sheet stays
                      static so the panel doesn't feel slow to open. */}
                  <AnimatePresence initial={false}>
                    {group.items.map((n) => {
                      /* A row only DRESSES as a control when a tap on it does
                         something (see `isActionable`). When it doesn't, every
                         part of the promise comes off together — the role, the
                         tab stop, the pointer cursor, the press feedback and
                         the handlers — because leaving any one of them behind
                         still tells the user "press me". The row keeps its
                         padding and min-height so the list rhythm is
                         unchanged; only the affordance goes. */
                      const actionable = isActionable(n);
                      return (
                      <motion.div
                        key={n.id}
                        role={actionable ? "button" : undefined}
                        tabIndex={actionable ? 0 : undefined}
                        onClick={actionable ? () => handleClick(n) : undefined}
                        onKeyDown={
                          actionable
                            ? (e: ReactKeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleClick(n);
                                }
                              }
                            : undefined
                        }
                        layout={!reducedMotion}
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
                        // `min-h-[44px]`: the row is the primary tap target in
                        // this panel and must clear the HIG floor even when a
                        // notification is a single short line.
                        className={`w-full text-left px-4 py-3 min-h-[44px] transition-colors${
                          actionable ? " active:opacity-80 cursor-pointer" : ""
                        }`}
                        style={{
                          background: !n.read ? "hsl(var(--burnt-sienna) / 0.06)" : undefined,
                          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
                        }}
                      >
                        <div className="flex gap-3">
                          <div
                            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                            style={{
                              background: !n.read ? "hsl(var(--burnt-sienna) / 0.12)" : "hsl(var(--bark) / 0.08)",
                              color: !n.read ? "hsl(var(--burnt-sienna))" : "hsl(var(--bark))",
                            }}
                          >
                            {typeIcons[n.type] || typeIcons.info}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p
                                className="min-w-0 flex-1 font-display italic font-bold leading-tight truncate text-ds-15"
                                style={{
                                  color: !n.read ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.8)",
                                  letterSpacing: "-0.012em",
                                }}
                              >
                                {n.title}
                              </p>
                              {/* Colour alone cannot carry "unread" — labelled
                                  the same way ConversationRow's dot is. */}
                              {!n.read && (
                                <span
                                  role="status"
                                  aria-label="Unread"
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: "hsl(var(--burnt-sienna))" }}
                                />
                              )}
                            </div>
                            <p
                              className="font-serif italic mt-0.5 line-clamp-2 text-ds-12"
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              {n.message}
                            </p>
                            {/* Inline quick-action pills — only for actionable
                                types so chat/review/payment rows stay clean. */}
                            {(() => {
                              const actions: { label: string; href: string }[] = [];
                              if (n.type === "expired") {
                                actions.push({ label: "Repost", href: "/post-job" });
                              } else if (
                                n.type === "warning" &&
                                (n.title.toLowerCase().includes("cancelled") ||
                                  n.message.toLowerCase().includes("auto-cancel"))
                              ) {
                                actions.push({ label: "Repost", href: "/post-job" });
                              } else if (
                                n.type === "job_update" &&
                                n.message.toLowerCase().includes("cancelled") &&
                                n.link
                              ) {
                                actions.push({ label: "View", href: n.link });
                              }
                              if (actions.length === 0) return null;
                              return (
                                <div className="flex gap-1.5 mt-1.5">
                                  {actions.map((a) => (
                                    <button
                                      key={a.label}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void markAsRead(n.id);
                                        setOpen(false);
                                        navigate(a.href);
                                      }}
                                      className="h-9 px-3 text-ds-11 font-sans font-semibold rounded-ds-md border transition-all active:scale-[0.94]"
                                      style={{
                                        borderColor: "hsl(var(--bark) / 0.35)",
                                        color: "hsl(var(--bark))",
                                        background: "hsl(var(--parchment) / 0.6)",
                                      }}
                                    >
                                      {a.label}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                            <p
                              className="font-serif italic mt-1 text-ds-11"
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              {timeAgo(n.created_at)}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </section>
              ))}
            </div>
          )}
        </PullToRefreshWrapper>

        {/* The list is a page; the badge is a fact. When they differ, say so.
            The alternative — quietly shrinking the badge to match what was
            fetched — is what produced a bell reading 47 over a database
            holding 76. "Mark all read" still only claims the rows on screen,
            which is why this line names the shown count first. */}
        {hasMoreThanPage && (
          <p
            className="shrink-0 px-4 py-2 text-ds-11 font-sans text-center border-t border-[hsl(var(--olivewood)/0.12)]"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Showing the latest {notifications.length} · {unreadTotal} unread in total
          </p>
        )}

        {/* Push opt-in lives in a footer row, outside the scroll area, rather
            than as a big button inside the empty state — it is relevant
            whether or not the list is empty, and it is the one thing here
            that changes what lands in this panel in future. */}
        {showPushRow && (
          <button
            type="button"
            onClick={enablePush}
            className="shrink-0 w-full h-11 inline-flex items-center justify-center gap-1.5 text-ds-12 font-sans font-semibold border-t border-[hsl(var(--olivewood)/0.12)] transition-colors hover:bg-[hsl(var(--bark)/0.06)]"
            style={{
              color: "hsl(var(--bark))",
              marginBottom: "var(--safe-area-bottom, 0px)",
            }}
          >
            <BellRing className="w-4 h-4" strokeWidth={2.25} /> Turn on push notifications
          </button>
        )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationPanel;
