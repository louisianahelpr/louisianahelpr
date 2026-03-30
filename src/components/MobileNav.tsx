import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, MessageSquare, User, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/activity", icon: ClipboardList, label: "Activity", badgeKey: "activity" as const },
];

const rightItems = [
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const [activityBadgeCount, setActivityBadgeCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const loadCounts = () => {
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("read", false)
        .then(({ count }) => setUnreadCount(count || 0));

      // Count job updates: jobs where user is customer or helper with recent status changes
      // Use applications with pending status as a proxy for "new activity"
      supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .in("job_id", 
          supabase.from("jobs").select("id").eq("customer_id", user.id)
        )
        .then(({ count }) => setActivityBadgeCount(count || 0));
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
        { event: "*", schema: "public", table: "applications" },
        () => loadCounts()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        () => loadCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const authPages = ["/dashboard", "/activity", "/post-job", "/profile", "/messages", "/admin", "/support", "/schedule", "/user", "/community", "/earnings", "/jobs", "/my-jobs", "/job-history"];
  const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/account-pending", "/account-denied"];
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Hide nav when in an active message conversation
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: any; label: string; badgeKey?: "messages" | "activity" }) => {
    const active = location.pathname === path;
    const badgeCount = badgeKey === "messages" ? unreadCount : badgeKey === "activity" ? unreadNotifCount : 0;
    const showBadge = badgeCount > 0;
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
          aria-label="Post a new job"
          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-[0_4px_24px_-2px_hsl(158_45%_42%/0.5)] flex items-center justify-center shrink-0 border border-primary-foreground/15 active:scale-95 transition-transform duration-150"
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
};

export default MobileNav;
