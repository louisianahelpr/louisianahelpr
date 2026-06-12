import { useEffect, useMemo, useState, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Send,
  MessageSquare,
  User,
  Plus,
  ClipboardList,
  CheckCheck,
  Filter,
  Inbox,
  Briefcase,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { safeStorage } from "@/lib/safeStorage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";
import { useLongPress } from "@/hooks/useLongPress";
import { prefetchRoute } from "@/lib/routePrefetch";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { setAppIconBadge } from "@/lib/appBadge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * Durable cache key for the Messages badge count. We mirror the last-known
 * count to localStorage (+ Capacitor Preferences via safeStorage's `helpr_`
 * prefix) so the badge doesn't flicker to 0 on a cold start with no network.
 * The number is re-validated as soon as the live query lands, but the
 * cached value is what paints on the FIRST frame.
 */
const UNREAD_CACHE_KEY = "helpr_nav_unread_count";

/** Read the cached unread count, defaulting to 0 if missing/malformed. */
function readCachedUnread(): number {
  try {
    const raw = safeStorage.getItem(UNREAD_CACHE_KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCachedUnread(n: number) {
  try {
    safeStorage.setItem(UNREAD_CACHE_KEY, String(Math.max(0, n)));
  } catch {
    /* best-effort */
  }
}

/**
 * Quick-action row used inside the long-press action sheet. Generic
 * icon + label + tap target — kept here (rather than promoted to a
 * shared component) because no other surface in the app currently
 * needs this exact shape.
 */
interface QuickActionRowProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}
const QuickActionRow = ({ icon: Icon, label, onClick }: QuickActionRowProps) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 rounded-ds-md px-4 py-3 text-left transition-colors min-h-[48px] hover:bg-[hsl(var(--olivewood)/0.06)] active:bg-[hsl(var(--olivewood)/0.10)]"
    style={{ color: "hsl(var(--ink-deep))" }}
  >
    <Icon className="w-5 h-5" strokeWidth={1.8} />
    <span className="font-display italic font-semibold text-[0.95rem]">{label}</span>
  </button>
);

/**
 * Internal tab button — extracted from MobileNav so we can call
 * `useLongPress` once per tab (hooks can't be called inside a `.map()`
 * loop). Renders the same `<button>` shell the inline version did; layout
 * + visual treatment is unchanged. Long-press fires `onLongPress` after
 * ~500ms; short taps fall through to `onTap`. When `longPressEnabled` is
 * false (guest-locked tabs, no actions defined) we strip the long-press
 * handlers so the gesture stays a plain tap.
 */
interface TabButtonProps {
  onTap: () => void;
  onLongPress: () => void;
  longPressEnabled: boolean;
  onPrefetch: () => void;
  ariaLabel: string;
  ariaCurrent: "page" | undefined;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const TabButton = ({
  onTap,
  onLongPress,
  longPressEnabled,
  onPrefetch,
  ariaLabel,
  ariaCurrent,
  className,
  style,
  children,
}: TabButtonProps) => {
  // `useLongPress` returns props to spread on the element. When long-press
  // isn't enabled, we ignore the press handlers and wire onClick directly
  // so the tab keeps behaving as a normal button.
  const longPress = useLongPress({
    threshold: 500,
    onLongPress,
    onTap,
  });

  if (!longPressEnabled) {
    return (
      <button
        onClick={onTap}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onTouchStart={onPrefetch}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
        className={className}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      // useLongPress drives both onTouch* and onMouse*, including `release`
      // which fires the short-tap callback if the threshold wasn't crossed.
      // We DON'T set onClick here — the hook's onTouchEnd / onMouseUp paths
      // already cover both pointer types, and a duplicate onClick would
      // either double-fire on touch (web → both touchend + a synthetic
      // click) or fight with the tap-on-release logic.
      //
      // Edge case: a mouse user without onClick wouldn't get a keyboard
      // Enter activation (Enter dispatches click, not mousedown). We wire
      // an explicit onKeyDown so the tab is still keyboard-operable.
      {...longPress}
      onTouchStart={(e) => {
        longPress.onTouchStart(e);
        onPrefetch();
      }}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      aria-haspopup="menu"
      className={className}
      style={style}
    >
      {children}
    </button>
  );
};

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: Send, label: "Posts", badgeKey: "posts" as const },
];

const rightItems = [
  { path: "/my-jobs", icon: ClipboardList, label: "Jobs", badgeKey: "jobs" as const },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isLoading } = useCurrentUser();
  const isGuest = !isLoading && !user;
  // A pending user can browse/apply, but /post-job stays gated until
  // review clears. Hide the Post FAB for them so they don't tap into a
  // redirect — see ProtectedRoute (the route has no `allowPending`).
  const isPendingApproval =
    !isGuest && profile?.approval_status === "pending";
  // Seed the badge from the durable cache so a navigation/cold-start
  // without network still paints the last-known count on the first frame —
  // no flicker-to-0 while the live query resolves. The live query
  // (loadCounts) overwrites this on success and also writes back to the
  // cache so the next session is up to date.
  const [unreadCount, setUnreadCount] = useState<number>(() => readCachedUnread());
  // Lightweight "actionable activity" counts for the Posts / Jobs tab
  // badges (new applicants on your posts; pending direct offers to you).
  // Count-only queries — deliberately not the heavy useActivityData hook.
  const { postsCount, jobsCount } = useActivityBadgeCounts(user?.id);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateLabel, setGateLabel] = useState("this feature");
  // Long-press quick-action sheet — one sheet, with content keyed by which
  // tab was long-pressed. Keeps the markup compact instead of one sheet per
  // tab. `null` = closed.
  const [quickActionTab, setQuickActionTab] = useState<null | "/dashboard" | "/messages" | "/my-posts" | "/my-jobs" | "/profile">(null);
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
        .then(({ count, error }) => {
          // Only overwrite the seeded value on a successful response —
          // a failed query (offline, transient) must NOT zero the badge
          // and surprise the user. The cache stays the floor.
          if (error) return;
          const next = count || 0;
          setUnreadCount(next);
          writeCachedUnread(next);
        });
    };

    loadCounts();

    const channel = supabase
      // Nonce so a quick remount doesn't collide with the prior channel —
      // Supabase dedupes by name and would silently drop the new sub.
      .channel(`unread-nav-${user.id}-${channelNonce()}`)
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

  // Mirror the live unread count onto the native springboard (app-icon)
  // badge, so the home-screen icon carries the unread number like every
  // other messaging app — even while the app is backgrounded. No-op on web
  // and best-effort on native (see setAppIconBadge). A signed-out/guest user
  // has nothing to badge, so force it to zero.
  useEffect(() => {
    void setAppIconBadge(user ? unreadCount : 0);
  }, [user, unreadCount]);

  // Long-press quick-action handlers. Each one closes the sheet and runs
  // the action; the action itself may navigate, fire a toast, or trigger a
  // backend mutation. Wrapped in `useMemo` so the inline lambdas (and the
  // SheetContent's onSelect handlers) don't churn identity on every parent
  // re-render — keeps the framer-motion sheet animation steady.
  //
  // Declared BEFORE the early returns below so `useMemo` is always called
  // in the same order across renders (rules-of-hooks).
  const quickActions = useMemo(() => {
    const close = () => setQuickActionTab(null);

    // Browse — open dashboard with a query param the page already parses
    // to open its filter sheet (?filters=open). If the page doesn't know
    // about that param it's a harmless no-op, so this is forward-safe.
    const browseFilters = () => {
      close();
      navigate("/dashboard?filters=open");
    };

    // Messages — best-effort mark-all-read. Optimistically zero the badge
    // (so the dot disappears in the same frame as the tap); on error the
    // realtime subscription will flip it back when the next live count
    // lands. Doesn't touch individual thread state — we run the same
    // update predicate the inbox uses.
    const markAllRead = async () => {
      close();
      if (!user) return;
      const prevCount = unreadCount;
      setUnreadCount(0);
      writeCachedUnread(0);
      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("receiver_id", user.id)
        .eq("read", false);
      if (error) {
        // Roll the badge back so the user sees the unread state honestly.
        setUnreadCount(prevCount);
        writeCachedUnread(prevCount);
        toast.error("Couldn't mark messages read — give it another try.");
        return;
      }
      toast.success("All messages marked read.");
    };

    // Posts / Jobs — jump directly to the relevant Activity tab (posted vs
    // applied). The Activity page reads the `tab` search param.
    const goPosted = () => {
      close();
      navigate("/activity?tab=posted");
    };
    const goApplied = () => {
      close();
      navigate("/activity?tab=applied");
    };

    // Profile — Multi-account placeholder. We don't have a switcher yet;
    // surface a toast so the user knows the long-press registered and a
    // feature is coming. Keeps the gesture discoverable without shipping
    // half-built UI.
    const switchAccountPlaceholder = () => {
      close();
      toast("Multi-account switching is coming soon.", {
        description: "We're working on it — long-press Profile to switch when it lands.",
      });
    };

    return {
      browseFilters,
      markAllRead,
      goPosted,
      goApplied,
      switchAccountPlaceholder,
    };
  }, [navigate, user, unreadCount]);

  const authPages = ["/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile", "/messages", "/support", "/schedule", "/availability", "/user", "/earnings", "/jobs", "/browse", "/job-history", "/account-pending", "/saved-helpers", "/community"];
  // /admin is a distinct console shell (its own full-height layout, header,
  // back button, and logout) — the consumer Posts/Jobs/Messages/Profile bar
  // doesn't belong there, so it's a no-nav page, not an auth tab route.
  const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/account-denied", "/admin"];
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Progressive activation: a pending user is NOT locked out of the bottom
  // nav tabs. Posts / Jobs / Messages / Profile are all `allowPending` /
  // `allowUnapproved` routes, so they navigate freely while review runs —
  // there is no `pendingLocked` branch any more. The Post FAB is the one
  // exception (`isPendingApproval` above hides it) since /post-job is still
  // gated. Verification still fires at the moments that genuinely need it
  // (accepting a job, payout) inside the page components.
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

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: any; label: string; badgeKey?: "messages" | "posts" | "jobs" }) => {
    // Guest-mode tab remap: Home -> /browse (the read-only home dashboard
    // that mirrors the real /dashboard), Profile -> /login. Other tabs stay
    // visually present but show a lock + open the signup sheet.
    const guestLocked = isGuest && !["/dashboard", "/profile"].includes(path);
    const locked = guestLocked;
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
    // Guests never carry a badge (nothing to count). Each badged tab pulls
    // from its own count source: Messages → unread DMs, Posts → new
    // applicants on your jobs, Jobs → pending direct offers to you.
    const badgeCount = isGuest
      ? 0
      : badgeKey === "messages"
        ? unreadCount
        : badgeKey === "posts"
          ? postsCount
          : badgeKey === "jobs"
            ? jobsCount
            : 0;
    const showBadge = badgeCount > 0;

    const handleClick = () => {
      if (guestLocked) {
        triggerGate(label.toLowerCase());
        return;
      }
      // Tab-switch haptic — only fires when the press actually moves the
      // user somewhere. Tapping the tab you're already on (a true no-op)
      // shouldn't buzz, otherwise it teaches users the haptic is decoupled
      // from navigation. `hapticLight` itself is web-safe (no-op + try/catch).
      // If we're inside this tab's stack but not on its root, pop back to root.
      if (!isGuest && inStack && location.pathname !== path) {
        hapticLight();
        navigate(path);
        return;
      }
      if (!isGuest && path === "/profile" && location.pathname === "/profile" && location.search) {
        hapticLight();
        navigate("/profile");
        return;
      }
      if (location.pathname !== effectivePath) {
        hapticLight();
        navigate(effectivePath);
        return;
      }
      if (location.search || location.hash) {
        hapticLight();
        navigate(effectivePath);
      }
    };

    // Long-press → quick-action sheet. Only the five real tabs have an
    // action set; locked guest tabs fall through to the standard tap-handles-
    // it path. We dispatch into a single shared sheet (`quickActionTab` state)
    // and a `hapticMedium` lets the user know the long-press registered.
    const longPressableTabs: Array<typeof path> = [
      "/dashboard",
      "/my-posts",
      "/my-jobs",
      "/messages",
      "/profile",
    ];
    const hasQuickActions = !locked && longPressableTabs.includes(path);
    const openQuickActions = () => {
      if (!hasQuickActions) return;
      hapticMedium();
      setQuickActionTab(path as typeof quickActionTab);
    };

    const isActive = active || inStack;
    return (
      <TabButton
        key={path}
        onTap={handleClick}
        onLongPress={openQuickActions}
        longPressEnabled={hasQuickActions}
        onPrefetch={() => !locked && prefetchRoute(effectivePath)}
        ariaLabel={locked ? `${label} — locked until your account is approved` : label}
        ariaCurrent={isActive ? "page" : undefined}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[48px] h-full transition-[color,transform] duration-200 active:scale-[0.95] [-webkit-tap-highlight-color:transparent] select-none ${locked ? "opacity-50" : ""}`}
        style={{ color: isActive ? "hsl(var(--olivewood))" : "hsl(48 9% 47%)" }}
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
              // Olive-green glass lens — the brand's action color (bark/olive),
              // lit from above. Selected reads as the brand green, not cream.
              // The pill is a soft bark wash; the icon + label sit on top in a
              // deeper olivewood so the contrast stays crisp (no olive-on-olive
              // mud).
              background:
                "radial-gradient(120% 120% at 30% 18%, hsl(var(--bark) / 0.20) 0%, hsl(var(--bark) / 0.14) 50%, hsl(var(--bark) / 0.22) 100%)",
              border: "0.5px solid hsl(var(--bark) / 0.30)",
              boxShadow:
                "inset 0 1px 1.5px 0 hsl(45 40% 98% / 0.55), " +
                "inset 0 -1.5px 2px 0 hsl(var(--bark) / 0.18), " +
                "0 1px 2px hsl(var(--olivewood) / 0.16), " +
                "0 6px 14px -4px hsl(var(--olivewood) / 0.24), " +
                "0 12px 22px -8px hsl(var(--olivewood) / 0.18)",
            }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden
          />
        )}
        <div className="relative z-10">
          <Icon
            className="w-[22px] h-[22px] transition-all duration-200"
            strokeWidth={isActive ? 2.3 : 1.8}
            fill={isActive ? "hsl(var(--olivewood) / 0.20)" : "none"}
          />
          {/* No per-tab padlock for guests — three padlocks in a row read
              as a barrier wall on a first-time guest's home screen. The tab
              is gently dimmed (opacity-50) and a tap routes to sign-up, so
              "locked" is communicated without the cluttered lock glyphs. The
              header's prominent Sign up button is the single unlock CTA. */}
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
          className="relative z-10 font-serif italic leading-none tracking-tight transition-[font-weight,color] duration-200"
          style={{
            fontSize: "0.66rem",
            fontWeight: isActive ? 700 : 500,
            letterSpacing: isActive ? "0.01em" : "0.02em",
            color: isActive ? "hsl(var(--olivewood))" : undefined,
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
      </TabButton>
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
      <nav ref={ref} aria-label="Bottom navigation" className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {/* Frosted curtain — full-width backdrop-blur layer behind the
            nav so any content scrolling up the page softly blurs as it
            passes through this band, not just under the centered pill.
            The mask gradient fades the blur to zero at the top so the
            transition into clear content above is smooth.

            The band must be at least as tall as the page-content scroll
            clearance the fixed-shell pages reserve for the dock
            (calc(safe-area-inset-bottom + 96px) — see PageScaffold /
            Profile / Messages). If the curtain were shorter, the last
            ~28px of reserved space would sit *above* the frost, so the
            panel/cards would read as ending in a hard horizontal line
            over bare page background rather than fading continuously
            under the glass. We anchor the band's top to that same
            clearance value (measured from the bottom of the viewport,
            i.e. the bottom of this `bottom-0` nav minus its own
            safe-area padding) and stretch the mask fade across the full
            band so there is no perceptible cutoff edge. */}
        <div
          aria-hidden
          className="absolute inset-x-0 pointer-events-none"
          style={{
            // Anchor the band to the bottom of the viewport (this nav is
            // `fixed bottom-0`; its `paddingBottom` is the safe-area inset,
            // so `bottom: -safe-area` puts the curtain's lower edge at the
            // true screen bottom) and give it a fixed height that covers
            // the full dock clearance the pages reserve (safe-area + 96px)
            // plus a 24px overhang so the fade begins in clear content.
            bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
            height: "calc(env(safe-area-inset-bottom, 0px) + 96px + 24px)",
            backdropFilter: "blur(32px) saturate(170%)",
            WebkitBackdropFilter: "blur(32px) saturate(170%)",
            // Longer fade (35% solid → transparent) so the blur ramps in
            // gradually across the band instead of snapping on partway up.
            maskImage: "linear-gradient(to top, black 35%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",
            background: "linear-gradient(to top, hsla(40, 28%, 99%, 0.6), hsla(40, 28%, 99%, 0))",
          }}
        />
        <div className="relative mx-3 mb-3 flex items-end gap-3.5 max-w-lg md:max-w-xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl md:mx-auto md:px-8 xl:px-12">
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
                  transform: "scale(1.28)",
                }}
              />
              <button
                onClick={handlePostClick}
                onMouseEnter={() => !isGuest && prefetchRoute("/post-job")}
                onFocus={() => !isGuest && prefetchRoute("/post-job")}
                aria-label={isGuest ? "Post a new job — sign up required" : "Post a new job"}
                className="group relative w-14 h-14 rounded-full flex items-center justify-center active:scale-[0.96] transition-transform duration-200"
                style={{
                  // Lit-from-top orb — a radial highlight in the upper-left
                  // fading to a deeper olive at the base gives the puck real
                  // sphere-like dimension instead of a flat disc.
                  background:
                    "radial-gradient(125% 125% at 32% 22%, hsl(76 20% 44%) 0%, hsl(var(--bark)) 46%, hsl(66 25% 19%) 100%)",
                  color: "hsl(var(--parchment))",
                  border: "1px solid hsl(66 26% 18%)",
                  boxShadow:
                    "inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.28), " +
                    "inset 0 -2px 3px 0 hsl(66 28% 14% / 0.45), " +
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

      {/* Quick-action sheet — opens from a long-press on a tab. The sheet's
          content is keyed by which tab triggered it; a single sheet keeps
          the markup compact and the animation singular. Closing by tapping
          outside, swiping down, or selecting an action all hit the same
          `setQuickActionTab(null)` path. */}
      <Sheet open={quickActionTab !== null} onOpenChange={(o) => { if (!o) setQuickActionTab(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          {quickActionTab === "/dashboard" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Browse jobs</SheetTitle>
                <SheetDescription>Quick filters for the feed.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 mt-6">
                <QuickActionRow icon={Filter} label="Open filter chips" onClick={quickActions.browseFilters} />
              </div>
            </>
          )}
          {quickActionTab === "/messages" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Messages</SheetTitle>
                <SheetDescription>Inbox quick actions.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 mt-6">
                <QuickActionRow icon={CheckCheck} label="Mark all read" onClick={quickActions.markAllRead} />
              </div>
            </>
          )}
          {quickActionTab === "/my-posts" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Posts</SheetTitle>
                <SheetDescription>Jump straight to a tab.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 mt-6">
                <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
                <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
              </div>
            </>
          )}
          {quickActionTab === "/my-jobs" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Jobs</SheetTitle>
                <SheetDescription>Jump straight to a tab.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 mt-6">
                <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
                <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
              </div>
            </>
          )}
          {quickActionTab === "/profile" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Profile</SheetTitle>
                <SheetDescription>Account quick actions.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 mt-6">
                <QuickActionRow icon={UsersIcon} label="Switch account" onClick={quickActions.switchAccountPlaceholder} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
});
MobileNav.displayName = "MobileNav";

export default MobileNav;
