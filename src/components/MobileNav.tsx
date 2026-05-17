import { useEffect, useState, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Send, MessageSquare, User, Plus, ClipboardList, Lock } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { prefetchRoute } from "@/lib/routePrefetch";
import { hapticLight } from "@/lib/haptics";
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

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useCurrentUser();
  const isGuest = !isLoading && !user;
  const [unreadCount, setUnreadCount] = useState(0);
  const [, setUnreadNotifCount] = useState(0);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateLabel, setGateLabel] = useState("this feature");
  // Scroll-aware shadow lift — when content is actually scrolled under the
  // nav, deepen the drop shadow so the bar reads as floating above the
  // page rather than glued to the bottom edge.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const checkScroll = () => {
      // Look at any scrollable region (window OR an internal AppShell scroll
      // container — most app routes use the latter).
      const winScrolled = window.scrollY > 8;
      const internal = document.querySelector<HTMLElement>(".app-shell-scroll");
      const internalScrolled = internal ? internal.scrollTop > 8 : false;
      setScrolled(winScrolled || internalScrolled);
    };
    checkScroll();
    window.addEventListener("scroll", checkScroll, { passive: true });
    const internal = document.querySelector<HTMLElement>(".app-shell-scroll");
    internal?.addEventListener("scroll", checkScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", checkScroll);
      internal?.removeEventListener("scroll", checkScroll);
    };
  }, [location.pathname]);

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
      // Tab-switch haptic — subtle confirmation on every nav tap (only
      // fires on native iOS/Android; web no-op via safe wrapper).
      hapticLight();
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
        aria-current={isActive ? "page" : undefined}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[48px] h-full transition-colors duration-200 btn-press ${
          isActive
            ? ""
            : "text-muted-foreground hover:text-foreground"
        } ${locked ? "opacity-50" : ""}`}
        style={isActive ? { color: "hsl(var(--bark))" } : undefined}
      >
        {/* Sliding active pill — single shared layoutId across all items
            so the pill animates between tabs when you switch. Sits BEHIND
            the icon + label content. Uses the same elevated vocabulary
            (inset rim light + layered Bark-tinted drop shadow) as the
            Post button + FAB so the active tab reads as a lifted lens. */}
        {isActive && (
          <motion.span
            layoutId="mobile-nav-pill"
            className="absolute inset-x-2 inset-y-1 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(120% 120% at 30% 25%, hsl(var(--bark) / 0.18) 0%, hsl(var(--bark) / 0.1) 70%, hsl(var(--bark) / 0.06) 100%)",
              border: "0.5px solid hsl(var(--bark) / 0.22)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.35), " +
                "inset 0 -1px 1px 0 hsl(var(--bark) / 0.1), " +
                "0 1px 2px hsl(var(--bark) / 0.12), " +
                "0 6px 14px -4px hsl(var(--bark) / 0.25), " +
                "0 12px 22px -8px hsl(var(--bark) / 0.18)",
            }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden
          />
        )}
        <div className="relative z-10">
          <Icon
            className="w-[22px] h-[22px] transition-all duration-200"
            strokeWidth={isActive ? 2.25 : 1.85}
            fill={isActive ? "hsl(var(--bark) / 0.18)" : "none"}
          />
          {locked && (
            <span className="absolute -bottom-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-muted border border-background flex items-center justify-center">
              <Lock className="w-2 h-2 text-muted-foreground" strokeWidth={3} />
            </span>
          )}
          {showBadge && (
            <span
              className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1"
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </div>
        {/* Italic Bodoni microtype label — matches the eyebrow style on
            the rest of the app. Slightly tighter tracking than Montserrat
            so 5 tabs still fit on a 320px viewport. */}
        <span
          className="relative z-10 font-serif italic leading-none tracking-tight"
          style={{
            fontSize: "0.66rem",
            fontWeight: isActive ? 600 : 500,
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </span>
        {/* Burnt-Sienna underline accent — 4px wide × 1.5px tall dot
            below the active label. Only renders for active so the
            non-active tabs stay clean. */}
        {isActive && (
          <motion.span
            layoutId="mobile-nav-underline"
            className="absolute bottom-0.5 w-1 h-[2px] rounded-full pointer-events-none"
            style={{
              background: "hsl(var(--burnt-sienna))",
              boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.45)",
            }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden
          />
        )}
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
        {/* Frosted curtain — full-width backdrop-blur layer behind the
            nav so any content scrolling up the page softly blurs as it
            passes through this band, not just under the centered pill.
            The mask gradient fades the blur to zero at the top so the
            transition into clear content above is smooth. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{
            top: "-16px",
            backdropFilter: "blur(32px) saturate(170%)",
            WebkitBackdropFilter: "blur(32px) saturate(170%)",
            maskImage: "linear-gradient(to top, black 55%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to top, black 55%, transparent 100%)",
            background: "linear-gradient(to top, hsla(38, 18%, 97%, 0.55), hsla(38, 18%, 97%, 0))",
          }}
        />
        <div className="relative mx-3 mb-3 flex items-end gap-2.5 max-w-lg md:max-w-xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl md:mx-auto md:px-8 xl:px-12">
          {/* Main nav pill — liquid glass. Shadow stack switches to the
              deeper "lifted" variant when the page is scrolled, so the bar
              reads as floating above content rather than glued to the
              bottom. */}
          <div
            className="flex-1 rounded-full transition-shadow duration-300"
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.4)",
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              // Stronger high-contrast white edge along the top — mimics
              // the Apple Dock's "glass-catching-light" rim. Sides + bottom
              // stay softer.
              borderTop: "1px solid hsla(0, 0%, 100%, 0.85)",
              borderLeft: "1px solid hsla(0, 0%, 100%, 0.55)",
              borderRight: "1px solid hsla(0, 0%, 100%, 0.55)",
              borderBottom: "1px solid hsla(0, 0%, 100%, 0.45)",
              // Bumped to match the elevated treatment used on the Post
              // button + FAB — bright top rim, subtle inset bottom, and
              // a more pronounced multi-stop spreading drop shadow.
              // Top-of-dock soft glow lifts the bar off the page, plus
              // a big ambient drop. No hard line — all very soft, very
              // wide spreads.
              boxShadow: scrolled
                ? "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.08), 0 -10px 40px rgba(0,0,0,0.06), 0 2px 4px hsl(var(--olivewood) / 0.08), 0 22px 44px -10px hsl(var(--olivewood) / 0.20), 0 50px 90px -20px hsl(var(--olivewood) / 0.24)"
                : "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.08), 0 -10px 40px rgba(0,0,0,0.05), 0 1px 2px hsl(var(--olivewood) / 0.06), 0 18px 36px -8px hsl(var(--olivewood) / 0.16), 0 40px 72px -16px hsl(var(--olivewood) / 0.20)",
            }}
          >
            <div className="flex items-stretch h-14 px-2">
              {[...leftItems, ...rightItems].map((item, i) => (
                <div key={item.path} className="flex flex-1 items-stretch relative">
                  {/* Hairline divider before each item except the first */}
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-px h-5"
                      style={{ background: "hsl(var(--olivewood) / 0.08)" }}
                    />
                  )}
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </div>

          {/* Post FAB — flat deep-olive (bark) puck with a soft static
              green halo plus a slow pulsing ring behind it to draw the
              eye to the primary action. Guest gating is handled by the
              gate sheet on tap, so no lock badge needed on the surface. */}
          {!isPendingApproval && (
            <div className="relative shrink-0 w-14 h-14">
              {/* Slow pulsing halo — sits behind the button so it draws the
                  eye without competing with the icon. motion-safe gates it
                  for users with reduced-motion preferences. */}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full motion-safe:animate-pulse pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle, hsl(var(--bark) / 0.38) 0%, hsl(var(--bark) / 0) 72%)",
                  filter: "blur(8px)",
                  transform: "scale(1.45)",
                }}
              />
              <button
                onClick={handlePostClick}
                onMouseEnter={() => !isGuest && prefetchRoute("/post-job")}
                onFocus={() => !isGuest && prefetchRoute("/post-job")}
                aria-label={isGuest ? "Post a new job — sign up required" : "Post a new job"}
                className="group relative w-14 h-14 rounded-full flex items-center justify-center active:scale-[0.96] transition-transform duration-200"
                style={{
                  background: "hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  border: "1px solid hsl(70 22% 24%)",
                  boxShadow:
                    "inset 0 1px 0 0 rgba(255, 255, 255, 0.10), " +
                    "0 1px 2px hsl(70 20% 18% / 0.22), " +
                    "0 8px 18px -6px hsl(var(--bark) / 0.55), " +
                    "0 18px 36px -12px hsl(var(--bark) / 0.4), " +
                    "0 0 0 6px hsl(var(--bark) / 0.06), " +
                    "0 0 24px 4px hsl(var(--bark) / 0.22)",
                }}
              >
                <Plus
                  className="w-7 h-7 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:rotate-90 motion-safe:group-active:rotate-180"
                  strokeWidth={2.75}
                  style={{ color: "hsl(var(--parchment))" }}
                />
              </button>
            </div>
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
              className="text-ds-11 text-muted-foreground py-2 hover:text-foreground transition-colors"
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
