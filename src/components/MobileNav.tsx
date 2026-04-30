import { useEffect, useState, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Send, MessageSquare, User, Plus, ClipboardList, Lock } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { prefetchRoute } from "@/lib/routePrefetch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: Send, label: "Posts" },
];

const rightItems = [
  { path: "/my-jobs", icon: ClipboardList, label: "Jobs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: User, label: "Profile" },
];

// Routes guests are allowed to land on. Anything else triggers the
// signup sheet instead of navigating. /browse is the read-only "home
// dashboard" iOS guests open into; /jobs is the older simple list (kept
// for web links / deep links during the transition).
const GUEST_OPEN_ROUTES = new Set(["/browse", "/jobs", "/login", "/signup"]);

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useCurrentUser();
  const isGuest = !isLoading && !user;
  const [unreadCount, setUnreadCount] = useState(0);
  const [, setUnreadNotifCount] = useState(0);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateLabel, setGateLabel] = useState("this feature");

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

  const authPages = ["/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile", "/messages", "/admin", "/support", "/schedule", "/availability", "/user", "/earnings", "/jobs", "/browse", "/job-history", "/account-pending", "/saved-helpers"];
  const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/account-denied"];
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Pending-approval lock: user is signed in but profile not yet approved.
  // They can browse the home dashboard but everything else is gated until
  // an admin clears them. Detected via route OR profile.approval_status.
  const isPendingApproval =
    location.pathname.startsWith("/account-pending");
  // Guest "tease & convert" bottom nav is iOS/Android-app only.
  // On the web, guests should see only the top Navbar (no bottom bar).
  if (isGuest && !Capacitor.isNativePlatform()) return null;

  // Hide nav when in an active message conversation
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  // Map each tab root to sub-routes that belong to its stack.
  // Tapping the tab while inside one of these returns the user to the tab root.
  const tabStacks: Record<string, string[]> = {
    "/dashboard": ["/jobs"],
    "/my-posts": ["/activity", "/post-job"],
    "/my-jobs": ["/job-history", "/earnings"],
    "/messages": [],
    "/profile": ["/support", "/user", "/admin", "/schedule", "/availability", "/saved-helpers"],
  };

  const isInStack = (tabPath: string) => {
    if (location.pathname === tabPath) return true;
    const stack = tabStacks[tabPath] || [];
    return stack.some((p) => location.pathname.startsWith(p));
  };

  const triggerGate = (label: string) => {
    setGateLabel(label);
    setGateOpen(true);
  };

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: any; label: string; badgeKey?: "messages" | "activity" }) => {
    // Guest-mode tab remap: Home -> /browse (the read-only home dashboard
    // that mirrors the real /dashboard), Profile -> /login. Other tabs stay
    // visually present but show a lock + open the signup sheet.
    const guestLocked = isGuest && !["/dashboard", "/profile"].includes(path);
    const pendingLocked = !isGuest && isPendingApproval && path !== "/dashboard";
    const locked = guestLocked || pendingLocked;
    const effectivePath = isGuest
      ? path === "/dashboard"
        ? "/browse"
        : path === "/profile"
          ? "/login"
          : path
      : path;

    const active =
      location.pathname === effectivePath ||
      (path === "/my-posts" && location.pathname === "/activity" && !new URLSearchParams(location.search).get("tab")) ||
      (path === "/my-jobs" && location.pathname === "/activity" && new URLSearchParams(location.search).get("tab") === "applied") ||
      (isGuest && path === "/dashboard" && (location.pathname === "/browse" || location.pathname === "/jobs"));

    const inStack = !isGuest && isInStack(path);
    const badgeCount = !isGuest && badgeKey === "messages" ? unreadCount : 0;
    const showBadge = badgeCount > 0;

    const handleClick = () => {
      if (guestLocked) {
        triggerGate(label.toLowerCase());
        return;
      }
      if (pendingLocked) {
        // Pending users can browse the home dashboard but nothing else.
        // Send them back to the review screen so they can sync status.
        navigate("/account-pending");
        return;
      }
      // If we're inside this tab's stack but not on its root, pop back to root.
      if (!isGuest && inStack && location.pathname !== path) {
        navigate(path);
        return;
      }
      if (!isGuest && path === "/profile" && location.pathname === "/profile" && location.search) {
        navigate("/profile");
        return;
      }
      if (location.pathname !== effectivePath) {
        navigate(effectivePath);
        return;
      }
      if (location.search || location.hash) {
        navigate(effectivePath);
      }
    };

    const isActive = active || inStack;
    return (
      <button
        key={path}
        onClick={handleClick}
        onMouseEnter={() => !locked && prefetchRoute(effectivePath)}
        onFocus={() => !locked && prefetchRoute(effectivePath)}
        onTouchStart={() => !locked && prefetchRoute(effectivePath)}
        aria-label={locked ? `${label} — locked until your account is approved` : label}
        className={`relative flex flex-col items-center justify-center gap-1 flex-1 min-h-[48px] h-full text-[11px] transition-colors duration-200 btn-press ${
          isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <div className="relative">
          <Icon
            className="w-[22px] h-[22px] transition-all duration-200"
            strokeWidth={isActive ? 2.25 : 2}
            fill={isActive ? "hsl(var(--primary) / 0.2)" : "none"}
          />
          {locked && (
            <span className="absolute -bottom-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-muted border border-background flex items-center justify-center">
              <Lock className="w-2 h-2 text-muted-foreground" strokeWidth={3} />
            </span>
          )}
          {showBadge && (
            <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold px-1">
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </div>
        <span className={`font-medium tracking-tight transition-all duration-200 ${isActive ? "font-semibold" : ""}`}>{label}</span>
      </button>
    );
  };

  const handlePostClick = () => {
    if (isGuest) {
      triggerGate("post a job");
      return;
    }
    navigate("/post-job");
  };

  return (
    <>
      <nav ref={ref} className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="mx-3 mb-2 flex items-end gap-2 max-w-lg md:max-w-xl lg:max-w-2xl md:mx-auto">
          {/* Main nav pill — glassmorphic: blur(12px), white border 20% */}
          <div className="flex-1 squircle rounded-full bg-white/60 dark:bg-white/5 backdrop-blur-[12px] backdrop-saturate-150 border border-white/20 shadow-[0_8px_28px_-8px_hsl(0_0%_0%/0.12)]" style={{ WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}>
            <div className="flex items-center justify-around h-14 px-2">
              {leftItems.map(renderItem)}
              {rightItems.map(renderItem)}
            </div>
          </div>

          {/* Post FAB — hidden entirely while a user is in the pending-approval lock */}
          {!isPendingApproval && (
            <button
              onClick={handlePostClick}
              onMouseEnter={() => !isGuest && prefetchRoute("/post-job")}
              onFocus={() => !isGuest && prefetchRoute("/post-job")}
              aria-label={isGuest ? "Post a new job — sign up required" : "Post a new job"}
              className="relative w-14 h-14 squircle rounded-3xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_0_0_4px_hsl(158_67%_37%/0.12),0_8px_28px_-4px_hsl(158_67%_37%/0.55),0_2px_8px_-2px_hsl(158_67%_37%/0.4)] flex items-center justify-center shrink-0 border border-white/25 active:scale-95 transition-all duration-200 hover:shadow-[0_0_0_6px_hsl(158_67%_37%/0.15),0_12px_32px_-4px_hsl(158_67%_37%/0.65)]"
            >
              <Plus className="w-7 h-7" strokeWidth={2.5} />
              {isGuest && (
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-background border border-primary/20 flex items-center justify-center">
                  <Lock className="w-2.5 h-2.5 text-primary" strokeWidth={3} />
                </span>
              )}
            </button>
          )}
        </div>
      </nav>

      <Sheet open={gateOpen} onOpenChange={setGateOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Sign up to {gateLabel}</SheetTitle>
            <SheetDescription>
              Join Helpr to post jobs, message helprs, and track your activity. It only takes a minute.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 mt-6">
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                setGateOpen(false);
                navigate("/signup");
              }}
            >
              Create free account
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => {
                setGateOpen(false);
                navigate("/login");
              }}
            >
              I already have an account
            </Button>
            <button
              onClick={() => setGateOpen(false)}
              className="text-sm text-muted-foreground py-2 hover:text-foreground transition-colors"
            >
              Keep browsing
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
});
MobileNav.displayName = "MobileNav";

export default MobileNav;
