import { useEffect, useState, useMemo, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { Bell, Check, CheckCheck, Info, AlertTriangle, DollarSign, Users, Star, BellRing, MessageCircle, Truck, Wrench, Sparkles, ShieldCheck, Megaphone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { isPushSupported, registerServiceWorker, requestPushPermission, showLocalNotification, getPushPermission } from "@/lib/pushNotifications";
import { toast } from "sonner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";

type Notification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
};

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-muted-foreground" />,
  success: <Check className="w-4 h-4 text-primary" />,
  warning: <AlertTriangle className="w-4 h-4 text-accent" />,
  application: <Users className="w-4 h-4 text-primary" />,
  payment: <DollarSign className="w-4 h-4 text-primary" />,
  review: <Star className="w-4 h-4 text-accent" />,
  job_update: <Info className="w-4 h-4 text-primary" />,
  job_updates: <Info className="w-4 h-4 text-primary" />,
  message: <MessageCircle className="w-4 h-4 text-primary" />,
  transit_updates: <Truck className="w-4 h-4 text-primary" />,
  work_status: <Wrench className="w-4 h-4 text-primary" />,
  new_offers: <Sparkles className="w-4 h-4 text-accent" />,
  system_alert: <Megaphone className="w-4 h-4 text-accent" />,
  financial_alerts: <DollarSign className="w-4 h-4 text-primary" />,
  verified: <ShieldCheck className="w-4 h-4 text-primary" />,
  job_match: <Sparkles className="w-4 h-4 text-primary" />,
  expired: <AlertTriangle className="w-4 h-4 text-muted-foreground" />,
};

const NotificationTrigger = forwardRef<HTMLButtonElement, { unreadCount: number } & React.ComponentPropsWithoutRef<typeof Button>>(
  ({ unreadCount, ...props }, ref) => (
    <Button ref={ref} variant="ghost" size="icon" className="relative" aria-label="Notifications" {...props}>
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none flex items-center justify-center font-bold ring-2 ring-background">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  )
);
NotificationTrigger.displayName = "NotificationTrigger";

type Filter = "all" | "unread";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Bucket notifications by relative day so the feed reads as a journal
// rather than a flat list. Today / Yesterday / This week / Earlier.
const groupByDay = (items: Notification[]) => {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const buckets: { key: string; label: string; items: Notification[] }[] = [
    { key: "today", label: "Today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "week", label: "This week", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];

  for (const n of items) {
    const t = new Date(n.created_at);
    if (t >= today) buckets[0].items.push(n);
    else if (t >= yesterday) buckets[1].items.push(n);
    else if (t >= weekAgo) buckets[2].items.push(n);
    else buckets[3].items.push(n);
  }

  return buckets.filter((b) => b.items.length > 0);
};

const NotificationPanel = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

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
      toast.error("Couldn't load notifications");
      return;
    }
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

    // Realtime subscription — also trigger browser push for new notifications
    const channel = supabase
      // Unique per mount — NotificationPanel renders in both the header
      // and the admin shell, and a shared channel name would collide.
      .channel(`notifications-realtime-${channelNonce()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, async (payload) => {
        const n = payload.new as Notification;
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && n.user_id === session.user.id) {
          setNotifications((prev) => [n, ...prev]);
          // Play notification chime + vibrate
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
          } catch {}
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          if (document.hidden && getPushPermission() === "granted") {
            showLocalNotification(n.title, n.message, n.link || undefined);
          }
        }
      })
      .subscribe();

    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, []);

  const enablePush = async () => {
    const granted = await requestPushPermission();
    if (granted) {
      setPushEnabled(true);
      toast.success("Push notifications enabled!");
    } else {
      toast.error("Notifications permission denied. Enable in browser settings.");
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
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleClick = (n: Notification) => {
    markAsRead(n.id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <NotificationTrigger unreadCount={unreadCount} />
      </SheetTrigger>
      <SheetContent
        className="w-full sm:max-w-md p-0 flex flex-col h-[100dvh]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0 text-left sm:text-left space-y-2">
          {/* Left-aligned title + Mark-all-read row sits beside the
              safe-area-aware close button (40px frosted circle in the
              top-right via Sheet primitive). pr-12 reserves room so
              long titles can't run under the close. */}
          <SheetTitle
            className="font-display italic font-bold text-left pr-12"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
          >
            Notifications
          </SheetTitle>
          <div className="flex items-center gap-2">
            {pushSupported && !pushEnabled && (
              <Button variant="ghost" size="sm" onClick={enablePush} className="text-ds-11 text-primary h-7 px-2">
                <BellRing className="w-3.5 h-3.5 mr-1" /> Enable push
              </Button>
            )}
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="text-ds-11 text-muted-foreground h-7 px-2 ml-auto">
                <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all read
              </Button>
            )}
          </div>
          {/* Filter pills — All / Unread. Lets users triage in feeds
              with volume; auto-falls-back to "All" when the active
              filter would render nothing (so unread→empty doesn't
              feel like the page is broken). */}
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
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-ds-11 font-sans font-semibold transition-all active:scale-[0.96] ${
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
                        color: isActive ? "hsl(var(--parchment) / 0.85)" : "hsl(var(--olivewood) / 0.55)",
                      }}
                    >
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
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
          {visibleNotifications.length === 0 ? (
            <div className="min-h-full flex flex-col items-center justify-center text-center gap-4 px-6 py-8">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500"
                style={{
                  backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                  backdropFilter: "blur(16px) saturate(150%)",
                  WebkitBackdropFilter: "blur(16px) saturate(150%)",
                  border: "1px solid hsla(0, 0%, 100%, 0.7)",
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
                <span className="text-display-eyebrow">All caught up</span>
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
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
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
                      color: "hsl(var(--burnt-sienna) / 0.78)",
                      background:
                        "linear-gradient(to bottom, hsla(38, 18%, 97%, 0.92), hsla(38, 18%, 97%, 0.78))",
                      backdropFilter: "blur(8px) saturate(140%)",
                      WebkitBackdropFilter: "blur(8px) saturate(140%)",
                      borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <span>{group.label}</span>
                    <span
                      className="tabular-nums font-sans not-italic font-semibold"
                      style={{ color: "hsl(var(--olivewood) / 0.5)", letterSpacing: "0.04em" }}
                    >
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className="w-full text-left px-4 py-3 transition-colors active:opacity-80"
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
                              className="font-display italic font-bold leading-tight truncate"
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
                            style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.78)" }}
                          >
                            {n.message}
                          </p>
                          <p
                            className="font-serif italic mt-1"
                            style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.55)" }}
                          >
                            {timeAgo(n.created_at)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
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
