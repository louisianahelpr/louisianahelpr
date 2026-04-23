import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Send, MessageSquare, User, Plus, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import helprIcon from "@/assets/helpr-icon.png";

/**
 * TabletSidebar — persistent left navigation shown at ≥768px (iPad + desktop).
 * Replaces the mobile bottom tab bar. Mirrors the same routes/badges as MobileNav
 * but laid out vertically with labels visible.
 *
 * Visibility is controlled by Tailwind: `hidden md:flex` here, and MobileNav
 * is `md:hidden`. The two never appear at the same time.
 */

const navItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: Send, label: "My Posts" },
  { path: "/my-jobs", icon: ClipboardList, label: "My Jobs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: User, label: "Profile" },
];

export default function TabletSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const loadCounts = () => {
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("read", false)
        .then(({ count }) => setUnreadCount(count || 0));
    };
    loadCounts();
    const channel = supabase
      .channel(`unread-tablet-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` },
        () => loadCounts()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Same auth/no-nav rules as MobileNav so the two stay in sync
  const authPages = [
    "/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile",
    "/messages", "/admin", "/support", "/schedule", "/user", "/community",
    "/earnings", "/jobs", "/job-history", "/saved-helpers",
  ];
  const noNavPages = [
    "/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password",
    "/account-pending", "/account-denied",
  ];
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  const tabStacks: Record<string, string[]> = {
    "/dashboard": ["/jobs", "/community"],
    "/my-posts": ["/activity", "/post-job"],
    "/my-jobs": ["/job-history", "/earnings", "/schedule"],
    "/messages": [],
    "/profile": ["/support", "/user", "/admin"],
  };

  const isActive = (path: string) => {
    if (location.pathname === path) return true;
    if (path === "/my-posts" && location.pathname === "/activity" && !new URLSearchParams(location.search).get("tab")) return true;
    if (path === "/my-jobs" && location.pathname === "/activity" && new URLSearchParams(location.search).get("tab") === "applied") return true;
    const stack = tabStacks[path] || [];
    return stack.some((p) => location.pathname.startsWith(p));
  };

  return (
    <aside
      className="hidden md:flex fixed top-0 left-0 bottom-0 z-40 w-60 lg:w-64 flex-col border-r border-border bg-card/80 backdrop-blur-xl"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
      }}
      aria-label="Primary"
    >
      {/* Brand */}
      <button
        onClick={() => navigate("/dashboard")}
        className="flex items-center gap-2 px-5 mb-6 active:scale-[0.98] transition-transform"
        aria-label="Helpr home"
      >
        <img src={helprIcon} alt="" className="w-8 h-8 rounded-lg" />
        <span className="font-serif text-xl font-bold text-foreground">Helpr</span>
      </button>

      {/* Primary CTA */}
      <div className="px-3 mb-4">
        <button
          onClick={() => navigate("/post-job")}
          className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/85 text-primary-foreground font-medium shadow-[0_4px_16px_-4px_hsl(158_67%_37%/0.4)] active:scale-[0.98] transition-transform"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
          Post a Job
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ path, icon: Icon, label, badgeKey }) => {
          const active = isActive(path);
          const badge = badgeKey === "messages" ? unreadCount : 0;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {badge > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
