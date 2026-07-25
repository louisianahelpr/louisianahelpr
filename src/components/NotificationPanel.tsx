import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { useReducedMotion } from "@/lib/accessibility";
import { Button } from "@/components/ui/button";
import { CheckCheck, BellRing } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetHero, SheetTrigger } from "@/components/ui/sheet";
import { isPushSupported, registerServiceWorker, showLocalNotification, getPushPermission } from "@/lib/pushNotifications";
import { useRequestPushPermission } from "@/lib/nativePush";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { ErrorState } from "@/components/ui/ErrorState";
import { report } from "@/lib/errorLogger";
import type { Notification, Filter } from "@/components/notificationPanel/types";
import { typeIcons, groupByDay, timeAgo } from "@/components/notificationPanel/notificationPanelHelpers";
import { NotificationTrigger } from "@/components/notificationPanel/NotificationTrigger";

const NotificationPanel = () => {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Differentiates "fetch failed" from "fetched, but no notifications"
  // — without this flag a failed initial load silently falls through to
  // the "All caught up" empty state, which would wrongly suggest the
  // user has no notifications.
  const [loadError, setLoadError] = useState(false);
  const requestPush = useRequestPushPermission();

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
      setLoadError((prev) => (notifications.length === 0 ? true : prev));
      toast.error("Couldn't load notifications — try again?");
      return;
    }
    setLoadError(false);
    if (data) setNotifications(data);
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      const userId = session?.user?.id;
      if (!userId) return;
      channel = supabase
        // Unique per mount — NotificationPanel renders in both the header
        // and the admin shell, and a shared channel name would collide.
        .channel(`notifications-realtime-${channelNonce()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          async (payload) => {
            const n = payload.new as Notification;
            setNotifications((prev) => [n, ...prev]);
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
    });

    return () => {
      clearTimeout(timer);
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
      toast.success("Push notifications enabled!");
    } else {
      toast.error(
        Capacitor.isNativePlatform()
          ? "Notifications are off. Turn them on in your device settings."
          : "Notifications are off. Turn them on in your browser settings.",
      );
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const visibleNotifications = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filter],
  );
  const groupedNotifications = useMemo(
    () => groupByDay(visibleNotifications),
    [visibleNotifications],
  );

  const markAsRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    // Optimistically clear unread state so the UI responds immediately.
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .in("id", unreadIds);
    if (error) {
      // Roll back the optimistic update and let the user retry.
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: false } : n)),
      );
      toast.error("Couldn't mark all as read — please try again.");
      return;
    }
    hapticLight();
  };

  const handleClick = (n: Notification) => {
    markAsRead(n.id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <NotificationTrigger unreadCount={unreadCount} />
      </SheetTrigger>
      <SheetContent
        className="w-full sm:max-w-md p-0 gap-0 flex flex-col h-[100dvh]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0 text-left sm:text-left space-y-3">
          {/* Canonical sheet header (SheetHero bakes in the pr-12 lane for the
              safe-area-aware close button). Was a hand-copied eyebrow→title
              stack — one of four sheets whose inline title sizes had drifted
              apart. SheetHero is the single source of truth. */}
          <SheetHero eyebrow="Your inbox" title="Notifications" />
          {/* One controls row: filter pills on the left, the
              Mark-all-read / Enable-push actions on the right. Keeping
              them on a single justified line (rather than a standalone
              right-floated button row) keeps the header compact and away
              from the close button. */}
          <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {([
              { key: "all" as Filter, label: "All", count: notifications.length },
              { key: "unread" as Filter, label: "Unread", count: unreadCount },
            ]).map((opt) => {
              const isActive = filter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilter(opt.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-ds-11 font-sans font-semibold transition-all active:scale-[0.96] ${
                    isActive
                      ? ""
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                  style={
                    isActive
                      ? {
                          background: "hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 4px 10px -4px hsl(var(--bark) / 0.3)",
                        }
                      : undefined
                  }
                >
                  {opt.label}
                  {opt.count > 0 && (
                    <span
                      className="tabular-nums text-[0.66rem] font-bold"
                      style={{
                        color: isActive ? "hsl(var(--parchment) / 0.85)" : "hsl(var(--olivewood) / 0.8)",
                      }}
                    >
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
            <div className="flex items-center gap-1 shrink-0">
              {pushSupported && !pushEnabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={enablePush}
                  className="text-ds-11 text-[hsl(var(--bark))] h-7 px-2 rounded-full hover:bg-[hsl(var(--bark)/0.08)] hover:text-[hsl(var(--bark))]"
                >
                  <BellRing className="w-3.5 h-3.5 mr-1" /> Enable push
                </Button>
              )}
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllRead}
                  className="text-ds-11 text-[hsl(var(--bark))] h-7 px-2 rounded-full hover:bg-[hsl(var(--bark)/0.08)] hover:text-[hsl(var(--bark))]"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all read
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>
        <PullToRefreshWrapper
          ref={containerRef}
          pullDistance={pullDistance}
          refreshing={refreshing}
          isPulling={isPulling}
          canTrigger={canTrigger}
          className="flex-1 min-h-0 no-scrollbar overscroll-contain"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {loadError && notifications.length === 0 ? (
            // A failed initial load takes precedence over the "All caught
            // up" empty state — show a recoverable retry surface so the
            // user can recover from a transient hiccup without closing
            // and re-opening the panel.
            <div className="px-4 pt-6 flex min-h-full">
              <ErrorState
                variant="inline"
                title="We couldn't load your notifications."
                onRetry={loadNotifications}
              />
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="min-h-full flex flex-col items-center justify-center text-center gap-4 px-6 py-8">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500"
                style={{
                  backgroundColor: "hsl(var(--ivory-sand) / 0.55)",
                  backdropFilter: "blur(16px) saturate(150%)",
                  WebkitBackdropFilter: "blur(16px) saturate(150%)",
                  border: "1px solid hsl(var(--olivewood) / 0.18)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
                }}
              >
                {/* CheckCheck reads as "all clear / done done" — warmer
                    than a sleepy bell when the user actively cleared
                    their feed or arrived to an empty inbox. */}
                <CheckCheck className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
              </div>
              <div className="space-y-1.5">
                <span className="text-display-eyebrow">All caught up.</span>
                <p
                  className="font-display italic font-bold leading-tight"
                  style={{
                    fontSize: "clamp(1.1rem, 1.5vw + 0.4rem, 1.4rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {filter === "unread" && notifications.length > 0
                    ? "Nothing unread."
                    : "Nothing new yet."}
                </p>
                <p
                  className="font-serif italic text-ds-13 leading-relaxed max-w-xs mx-auto"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {filter === "unread" && notifications.length > 0
                    ? "Switch to All to see everything from this week."
                    : "Applications, messages, payouts, and job updates will land here as they happen."}
                </p>
              </div>
              {/* When the user has read everything but their list isn't
                  empty, give them a quick switch back to All instead of
                  having to find the filter pill manually. */}
              {filter === "unread" && notifications.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setFilter("all")}
                  className="rounded-ds-md mt-1"
                >
                  Show all notifications
                </Button>
              )}
              {filter === "all" && pushSupported && !pushEnabled && (
                <Button
                  variant="bark"
                  onClick={enablePush}
                  className="rounded-ds-md mt-1"
                >
                  <BellRing className="w-4 h-4 mr-2" /> Turn on push notifications
                </Button>
              )}
            </div>
          ) : (
            <div>
              {groupedNotifications.map((group) => (
                <section key={group.key}>
                  <div
                    className="sticky top-0 z-10 px-4 py-1.5 flex items-center justify-between font-serif italic uppercase tracking-[0.18em] text-[0.62rem]"
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
                    {group.items.map((n) => (
                      <motion.div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        layout={!reducedMotion}
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
                        onClick={() => handleClick(n)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleClick(n);
                          }
                        }}
                        className="w-full text-left px-4 py-3 transition-colors active:opacity-80 cursor-pointer"
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
                                className="min-w-0 flex-1 font-display italic font-bold leading-tight truncate"
                                style={{
                                  fontSize: "0.92rem",
                                  color: !n.read ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.8)",
                                  letterSpacing: "-0.012em",
                                }}
                              >
                                {n.title}
                              </p>
                              {!n.read && (
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: "hsl(var(--burnt-sienna))" }}
                                />
                              )}
                            </div>
                            <p
                              className="font-serif italic mt-0.5 line-clamp-2"
                              style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
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
                                        markAsRead(n.id);
                                        setOpen(false);
                                        navigate(a.href);
                                      }}
                                      className="h-6 px-2.5 text-ds-11 font-sans font-semibold rounded-full border transition-all active:scale-[0.94]"
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
                              className="font-serif italic mt-1"
                              style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              {timeAgo(n.created_at)}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </section>
              ))}
            </div>
          )}
        </PullToRefreshWrapper>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationPanel;
