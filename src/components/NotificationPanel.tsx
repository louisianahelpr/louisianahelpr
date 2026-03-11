import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bell, Check, CheckCheck, Info, AlertTriangle, DollarSign, Users, Star, BellRing } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { isPushSupported, registerServiceWorker, requestPushPermission, showLocalNotification, getPushPermission } from "@/lib/pushNotifications";
import { toast } from "sonner";

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
};

const NotificationPanel = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  const loadNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data);
  };

  useEffect(() => {
    loadNotifications();

    // Check push support
    const supported = isPushSupported();
    setPushSupported(supported);
    if (supported) {
      setPushEnabled(getPushPermission() === "granted");
      registerServiceWorker();
    }

    // Realtime subscription — also trigger browser push for new notifications
    const channel = supabase
      .channel("notifications-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, async (payload) => {
        const n = payload.new as Notification;
        // Only show if it's for the current user
        const { data: { user } } = await supabase.auth.getUser();
        if (user && n.user_id === user.id) {
          setNotifications((prev) => [n, ...prev]);
          // Trigger browser push if enabled and tab is not focused
          if (document.hidden && getPushPermission() === "granted") {
            showLocalNotification(n.title, n.message, n.link || undefined);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold min-w-[18px] h-[18px]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-display">Notifications</SheetTitle>
            <div className="flex items-center gap-1">
              {pushSupported && !pushEnabled && (
                <Button variant="ghost" size="sm" onClick={enablePush} className="text-xs text-primary">
                  <BellRing className="w-3.5 h-3.5 mr-1" /> Enable push
                </Button>
              )}
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs text-muted-foreground">
                  <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all read
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>
        <div className="overflow-y-auto max-h-[calc(100vh-5rem)]">
          {notifications.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Bell className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div>
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border hover:bg-secondary/50 transition-colors ${
                    !n.read ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex-shrink-0">
                      {typeIcons[n.type] || typeIcons.info}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>
                          {n.title}
                        </p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationPanel;
