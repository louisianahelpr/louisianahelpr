import { useEffect, useState, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Send, MessageSquare, User, Plus, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { prefetchRoute } from "@/lib/routePrefetch";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: Send, label: "Posts" },
];

const rightItems = [
  { path: "/my-jobs", icon: ClipboardList, label: "Jobs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const loadCounts = () => {
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("read", false)
        .then(({ count }) => setUnreadCount(count || 0));

      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false)
        .then(({ count }) => setUnreadNotifCount(count || 0));
    };

    loadCounts();

    const channel = supabase
      .channel(`unread-nav-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` },
        () => loadCounts()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => loadCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const authPages = ["/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile", "/messages", "/admin", "/support", "/schedule", "/user", "/community", "/earnings", "/jobs", "/job-history"];
  const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/account-pending", "/account-denied"];
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Hide nav when in an active message conversation
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  // Map each tab root to sub-routes that belong to its stack.
  // Tapping the tab while inside one of these returns the user to the tab root.
  const tabStacks: Record<string, string[]> = {
    "/dashboard": ["/jobs", "/community"],
    "/my-posts": ["/activity", "/post-job"],
    "/my-jobs": ["/job-history", "/earnings", "/schedule"],
    "/messages": [],
    "/profile": ["/support", "/user", "/admin"],
  };

  const isInStack = (tabPath: string) => {
    if (location.pathname === tabPath) return true;
    const stack = tabStacks[tabPath] || [];
    return stack.some((p) => location.pathname.startsWith(p));
  };

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: any; label: string; badgeKey?: "messages" | "activity" }) => {
    const active = location.pathname === path || (path === "/my-posts" && location.pathname === "/activity" && !new URLSearchParams(location.search).get("tab")) || (path === "/my-jobs" && location.pathname === "/activity" && new URLSearchParams(location.search).get("tab") === "applied");
    const inStack = isInStack(path);
    const badgeCount = badgeKey === "messages" ? unreadCount : 0;
    const showBadge = badgeCount > 0;
    const handleClick = () => {
      // If we're inside this tab's stack but not on its root, pop back to root.
      if (inStack && location.pathname !== path) {
        navigate(path);
        return;
      }
      if (location.pathname !== path) navigate(path);
    };
    return (
      <button
        key={path}
        onClick={handleClick}
        onMouseEnter={() => prefetchRoute(path)}
        onFocus={() => prefetchRoute(path)}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-all duration-200 btn-press ${
          active || inStack ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <div className="relative">
          <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
          {showBadge && (
            <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold px-1">
              {badgeCount > 9 ? "9+" : badgeCount}
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
    <nav ref={ref} className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
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
          onMouseEnter={() => prefetchRoute("/post-job")}
          onFocus={() => prefetchRoute("/post-job")}
          aria-label="Post a new job"
          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-[0_4px_24px_-2px_hsl(158_45%_42%/0.5)] flex items-center justify-center shrink-0 border border-primary-foreground/15 active:scale-95 transition-transform duration-150"
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
});
MobileNav.displayName = "MobileNav";

export default MobileNav;
