import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Send,
  ClipboardList,
  MessageSquare,
  User,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { isArchived, ARCHIVE_CHANGED_EVENT } from "@/lib/archivedConversations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";
import { prefetchRoute } from "@/lib/routePrefetch";
import { AUTH_PREFIXES, NO_NAV_PREFIXES, isDesktopRailRoute } from "@/lib/desktopNavRoutes";
export { AUTH_PREFIXES, NO_NAV_PREFIXES, isDesktopRailRoute };

/**
 * DesktopSidebarNav — the persistent left-rail navigation shown ONLY on the
 * wide desktop *website* (web-desktop). It is the desktop counterpart to the
 * floating bottom {@link MobileNav} dock; the two are mutually exclusive:
 *
 *   - Native iOS/Android app  → MobileNav (this component renders null).
 *   - Phone / tablet browser  → MobileNav.
 *   - Wide browser (≥1024px)  → DesktopSidebarNav (MobileNav is CSS-hidden via
 *                               `html.web-desktop .mobile-nav-frame { display:none }`).
 *
 * The gate here is identical to the one in useAppShellViewport that sets the
 * `web-desktop` class, so the rail can never appear in the native app:
 *   !Capacitor.isNativePlatform() && matchMedia('(min-width: 1024px)')
 *
 * This is intentionally a first-pass desktop chrome: brand wordmark, the five
 * primary destinations (Home / Posts / Jobs / Messages / Profile) plus the
 * post-task action. It reuses the same badge sources MobileNav uses so the
 * unread/activity counts stay consistent across the two navs.
 */

const NAV_ITEMS: Array<{
  path: string;
  icon: LucideIcon;
  label: string;
  badgeKey?: "messages" | "posts" | "jobs";
}> = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: Send, label: "Posts", badgeKey: "posts" },
  { path: "/my-jobs", icon: ClipboardList, label: "Jobs", badgeKey: "jobs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" },
  { path: "/profile", icon: User, label: "Profile" },
];

export function useIsWebDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (Capacitor.isNativePlatform() || typeof window.matchMedia !== "function") {
      setIsDesktop(false);
      return;
    }
    const mql = window.matchMedia("(min-width: 1024px)");
    const apply = (m: boolean) => setIsDesktop(m);
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return isDesktop;
}

const DesktopSidebarNav = () => {
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const { postsCount, jobsCount } = useActivityBadgeCounts(user?.id);
  const [unreadCount, setUnreadCount] = useState(0);

  const isPendingApproval = profile?.approval_status === "pending";

  // Mirror MobileNav's unread-count query so the Messages badge matches the
  // dock exactly. Scoped + nonced realtime channel per the project rules.
  useEffect(() => {
    if (!user) return;
    const loadCounts = async () => {
      const blockedSet = await getBlockedUserIds(user.id);
      const base = supabase
        .from("messages")
        .select("job_id, sender_id, created_at")
        .eq("receiver_id", user.id)
        .eq("read", false);
      let query: any = base;
      query = query.not("is_system", "is", true);
      if (blockedSet.size > 0) {
        query = query.not("sender_id", "in", `(${[...blockedSet].join(",")})`);
      }
      const { data, error } = await query;
      if (error) return;
      const next = (data ?? []).filter(
        (m: { job_id: string | null; sender_id: string | null; created_at: string }) =>
          !isArchived(user.id, m.job_id ?? "", m.sender_id ?? "", m.created_at),
      ).length;
      setUnreadCount(next);
    };
    loadCounts();
    const channel = supabase
      .channel(`unread-sidebar-${user.id}-${channelNonce()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` },
        () => loadCounts(),
      )
      .subscribe();
    const onArchiveChanged = () => loadCounts();
    window.addEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
    };
  }, [user?.id]);

  // Render nothing unless we're on the wide desktop website. This is the same
  // gate as the `web-desktop` <html> class, so the rail and the CSS that
  // insets the shell turn on/off together.
  if (!isWebDesktop) return null;
  if (!isDesktopRailRoute(location.pathname)) return null;
  // The rail is authed app chrome — its destinations are ProtectedRoutes. On a
  // guest-reachable rail route (e.g. /browse, which redirects authed users to
  // /dashboard, so its visitor is ALWAYS logged out) rendering the rail would
  // stack a second nav over the marketing Navbar and offer links that bounce to
  // /login. Gate on `!!user`, matching Navbar's `railOwnsNav` and the
  // `desktop-rail` inset gate in useAppShellViewport so all three move together.
  if (!user) return null;

  const badgeFor = (key?: "messages" | "posts" | "jobs") => {
    if (key === "messages") return unreadCount;
    if (key === "posts") return postsCount;
    if (key === "jobs") return jobsCount;
    return 0;
  };

  const isActive = (path: string) => {
    if (location.pathname === path) return true;
    if (path === "/my-posts")
      return location.pathname === "/activity" && !new URLSearchParams(location.search).get("tab");
    if (path === "/my-jobs")
      return (
        location.pathname === "/activity" &&
        new URLSearchParams(location.search).get("tab") === "applied"
      );
    return false;
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed left-0 bottom-0 z-40 hidden lg:flex lg:flex-col"
      style={{
        // Start the rail BELOW the full-width top header (h-14 = 3.5rem plus
        // any safe-area inset the header reserves) so the header — which spans
        // the entire viewport width and paints in a separate stacking context
        // — is never covered by the rail's top band.
        top: "calc(var(--safe-area-top, 0px) + 3.5rem)",
        width: "var(--desktop-sidebar-w, 248px)",
        background: "var(--glass-bg-crisp, hsl(0 0% 100% / 0.97))",
        borderRight: "1px solid hsl(var(--olivewood) / 0.12)",
        boxShadow: "1px 0 2px hsl(var(--olivewood) / 0.06)",
      }}
    >
      {/* The rail now starts beneath the header, so add a little breathing room
          at the top rather than a full header-height spacer. */}
      <div className="h-3 shrink-0" aria-hidden="true" />

      {/* Post-task primary action */}
      {!isPendingApproval && (
        <div className="px-4 pb-3">
          <button
            onClick={() => navigate("/post-job")}
            onMouseEnter={() => prefetchRoute("/post-job")}
            className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-sans font-semibold text-ds-15 transition-transform active:scale-[0.98]"
            style={{
              background:
                "radial-gradient(125% 125% at 32% 22%, hsl(var(--bark-light)) 0%, hsl(var(--bark)) 46%, hsl(var(--bark-border)) 100%)",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(var(--bark-border))",
              boxShadow:
                "inset 0 1.5px 1px 0 rgba(255,255,255,0.28), 0 8px 18px -6px hsl(var(--bark) / 0.5)",
            }}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            Post a job
          </button>
        </div>
      )}

      {/* Destinations */}
      <ul className="flex flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map(({ path, icon: Icon, label, badgeKey }) => {
          const active = isActive(path);
          const count = badgeFor(badgeKey);
          return (
            <li key={path}>
              <button
                onClick={() => navigate(path)}
                onMouseEnter={() => prefetchRoute(path)}
                aria-current={active ? "page" : undefined}
                className="group relative flex w-full items-center gap-3 rounded-ds-md px-3 py-2.5 text-left transition-colors"
                style={{
                  background: active ? "hsl(var(--bark) / 0.08)" : "transparent",
                  color: active ? "hsl(var(--bark))" : "hsl(var(--ink-deep))",
                }}
              >
                <span className="relative inline-flex">
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={active ? 2.3 : 1.8}
                    fill={active ? "hsl(var(--bark) / 0.16)" : "none"}
                  />
                  {count > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-ds-10 font-bold"
                      style={{
                        background: "hsl(var(--burnt-sienna))",
                        color: "hsl(var(--parchment))",
                      }}
                    >
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </span>
                <span
                  className="font-display italic text-ds-16"
                  style={{ fontWeight: active ? 700 : 500 }}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default DesktopSidebarNav;
