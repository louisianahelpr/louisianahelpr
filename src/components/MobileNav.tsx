import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, MessageSquare, User, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/activity", icon: ClipboardList, label: "Activity" },
];

const rightItems = [
  { path: "/messages", icon: MessageSquare, label: "Messages" },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const loadUnread = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("read", false);

      setUnreadCount(count || 0);

      // Subscribe to new messages
      channel = supabase
        .channel("unread-messages-nav")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` },
          () => {
            // Re-fetch count on any change
            supabase
              .from("messages")
              .select("*", { count: "exact", head: true })
              .eq("receiver_id", user.id)
              .eq("read", false)
              .then(({ count }) => setUnreadCount(count || 0));
          }
        )
        .subscribe();
    };

    loadUnread();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const authPages = ["/dashboard", "/activity", "/post-job", "/profile", "/messages", "/admin", "/support"];
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Hide nav when in an active message conversation
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  const renderItem = ({ path, icon: Icon, label }: { path: string; icon: any; label: string }) => {
    const active = location.pathname === path;
    const showBadge = path === "/messages" && unreadCount > 0;
    return (
      <button
        key={path}
        onClick={() => navigate(path)}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-all duration-200 btn-press ${
          active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <div className="relative">
          <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
          {showBadge && (
            <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold px-1">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
        <span className="font-medium">{label}</span>
        {active && (
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary transition-all duration-200" />
        )}
      </button>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="mx-3 mb-2 flex items-end gap-2 max-w-lg md:max-w-xl lg:max-w-2xl md:mx-auto">
        {/* Main nav pill — glassmorphism */}
        <div className="flex-1 rounded-2xl glass shadow-[0_-4px_30px_-4px_hsl(158_45%_42%/0.1),0_4px_20px_-4px_hsl(0_0%_0%/0.08)]">
          <div className="flex items-center justify-around h-14 px-2">
            {leftItems.map(renderItem)}
            {rightItems.map(renderItem)}
          </div>
        </div>

        {/* Post button bubble */}
        <button
          onClick={() => navigate("/post-job")}
          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-[0_4px_24px_-2px_hsl(158_45%_42%/0.5)] flex items-center justify-center shrink-0 border border-primary-foreground/15 active:scale-95 transition-transform duration-150"
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
};

export default MobileNav;
