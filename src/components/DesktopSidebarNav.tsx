import { report } from "@/lib/errorLogger";
import { useEffect, useState } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Send,
  ClipboardList,
  MessageSquare,
  User,
  Plus,
  ShieldAlert,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { isArchived, ARCHIVE_CHANGED_EVENT } from "@/lib/archivedConversations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { useSidePanel } from "@/components/sidePanelOpen";
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
 *   - Wide browser (≥900px)  → DesktopSidebarNav (MobileNav is CSS-hidden via
 *                               `html.web-desktop .mobile-nav-frame { display:none }`).
 *
 * The gate here is identical to the one in useAppShellViewport that sets the
 * `web-desktop` class, so the rail can never appear in the native app:
 *   !isNativePlatform && matchMedia('(min-width: 900px)')
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

/**
 * Admin — the SAME five destinations for everyone, plus one expandable group
 * for the accounts that have it (owner: "the side panel should be identical to
 * a non-admin user, just add the admin sections under the Admin in the
 * sidebar").
 *
 * Nested rather than flat because admin is not a sixth peer of Home/Posts/Jobs
 * — it is a console with twenty-odd sections of its own. Collapsed by default,
 * so a non-admin's panel and an admin's are the same height and the same shape
 * until the admin opens it.
 *
 * Sections come from `adminNavGroups`, the one list /admin itself renders, so
 * the two can't drift. Each links to `/admin?view=<id>`, a deep link the page
 * already handles.
 */

/* RE-EXPORT, not a second implementation.
   This file used to define its own copy of the hook with a `(min-width: 1024px)`
   query while `src/hooks/useIsWebDesktop.ts` — and index.css, and tailwind's
   `lg` — had already moved to 900. The two copies did not have the same
   consumers: AppShell / DesktopTopNav / Activity / FilterSheet read the 900
   version, while Navbar / Dashboard / Messages / this rail read the 1024 one.
   Between 900 and 1023 the html gained `web-desktop desktop-rail` and reserved
   248px for a rail that then returned null — a dead empty strip down the right
   of every authed page, with the hamburger appearing to do nothing.
   One query, one place. (Owner: "you need to fix this its currently 3
   different things.") */
export { useIsWebDesktop };

const DesktopSidebarNav = () => {
  const { open: sidePanelOpen } = useSidePanel();
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin } = useCurrentUser();
  // Admin's own sections, collapsed by default so an admin's panel is the same
  // shape as everyone else's until they open it. Auto-opens while you are
  // actually in the console, so the section you are looking at is never hidden.
  const adminActive = location.pathname === "/admin";
  const currentAdminView = new URLSearchParams(location.search).get("view") || "home";
  const [adminOpen, setAdminOpen] = useState(false);
  useEffect(() => {
    if (adminActive) setAdminOpen(true);
  }, [adminActive]);
  const { postsCount, jobsCount } = useActivityBadgeCounts(user?.id);
  const [unreadCount, setUnreadCount] = useState(0);

  const isPendingApproval = profile?.approval_status === "pending";

  // Mirror MobileNav's unread-count query so the Messages badge matches the
  // dock exactly. Scoped + nonced realtime channel per the project rules.
  useEffect(() => {
    if (!user) return;
    const loadCounts = async () => {
      // getBlockedUserIds now THROWS on a failed read rather than returning an
      // empty set, because an empty set reads as "nobody is blocked" and would
      // put blocked people back in the badge. Skip the update instead — a
      // slightly stale count is strictly better than surfacing blocked users.
      let blockedSet: Set<string>;
      try {
        blockedSet = await getBlockedUserIds(user.id);
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "DesktopSidebarNav.unreadCount" } });
        return;
      }
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
  // THE HAMBURGER'S JOB. The bar's Menu button toggles this flag; without it
  // the panel rendered unconditionally and the button did nothing visible — it
  // only released the rail's reserved width, which is not what "open and close
  // the side panel" means (owner).
  //
  // It is NOT `return null` any more. Unmounting is instantaneous, so the panel
  // vanished and reappeared with no motion at all — "should move in and out
  // smoother" (owner). It stays mounted and slides on `transform` instead, and
  // `visibility` is what actually removes it from the tab order and the
  // accessibility tree once it is off screen (a plain translate leaves a
  // focusable, announced panel sitting just outside the viewport).
  //
  // transform + visibility are both GPU-cheap and both transition, so the slide
  // stays at 60fps and nothing reflows while it moves — which is the other half
  // of "smoother". `aria-hidden` and `inert` keep it out of reach mid-flight.

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
      aria-hidden={!sidePanelOpen}
      // @ts-expect-error — `inert` is valid HTML; React's types lag it.
      inert={!sidePanelOpen ? "" : undefined}
      className={`fixed right-0 bottom-0 z-40 hidden lg:flex lg:flex-col motion-safe:transition-[transform,visibility] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] ${
        sidePanelOpen ? "translate-x-0 visible" : "translate-x-full invisible"
      }`}
      style={{
        // Start the rail BELOW the full-width top header (h-14 = 3.5rem plus
        // any safe-area inset the header reserves) so the header — which spans
        // the entire viewport width and paints in a separate stacking context
        // — is never covered by the rail's top band.
        // A CARD, like the content beside it (owner: "should we do round edge
        // at the top and some space too, similar to the box on the left").
        // It ran edge-to-edge with square corners and a hairline border while
        // every panel it sits next to is an inset, rounded, shadowed card — so
        // it read as chrome bolted to the window rather than part of the same
        // surface family.
        //
        // Inset from the header and the right edge, then rounded on the TOP
        // corners only: the bottom runs to the viewport floor, so rounding
        // there would leave two lit notches against the page behind it.
        top: "calc(var(--safe-area-top, 0px) + 3.5rem + 0.5rem)",
        right: "0.75rem",
        width: "calc(var(--desktop-sidebar-w, 248px) - 0.75rem)",
        background: "var(--glass-bg-crisp, hsl(0 0% 100% / 0.97))",
        border: "1px solid hsl(var(--olivewood) / 0.12)",
        borderBottom: "none",
        borderTopLeftRadius: "1rem",
        borderTopRightRadius: "1rem",
        // Lifted off the page on all sides now that it is not flush to the
        // edge — the old shadow only cast leftward because that was its only
        // exposed side.
        boxShadow: "0 1px 3px hsl(var(--olivewood) / 0.06), 0 8px 24px -12px hsl(var(--olivewood) / 0.18)",
      }}
    >
      {/* The rail now starts beneath the header, so add a little breathing room
          at the top rather than a full header-height spacer. */}
      <div className="h-3 shrink-0" aria-hidden="true" />


      {/* Post a Job leads the panel, above Home (owner). It is the one thing
          this rail exists to make one click away — the destinations below are
          places you can also reach from the bottom of the app. */}
      {!isPendingApproval && (
        <div className="px-4 pt-1 pb-2">
          <button
            onClick={() => navigate("/post-job")}
            onMouseEnter={() => prefetchRoute("/post-job")}
            className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-sans font-semibold text-ds-15 transition-transform active:scale-[0.98]"
            style={{
              background:
                "radial-gradient(125% 125% at 32% 22%, hsl(var(--bark-light)) 0%, hsl(var(--bark)) 46%, hsl(var(--bark-deep)) 100%)",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(var(--bark-border))",
              boxShadow:
                "inset 0 1.5px 1px 0 rgba(255,255,255,0.28), 0 8px 18px -6px hsl(var(--bark) / 0.5)",
            }}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            Post a Job
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

        {/* ADMIN — one row for admins, its sections nested under it. */}
        {isAdmin && (
          <li className="mt-1">
            <button
              onClick={() => setAdminOpen((v) => !v)}
              aria-expanded={adminOpen}
              aria-controls="side-panel-admin-sections"
              className="group relative flex w-full items-center gap-3 rounded-ds-md px-3 py-2.5 text-left transition-colors"
              style={{
                background: adminActive ? "hsl(var(--bark) / 0.08)" : "transparent",
                color: adminActive ? "hsl(var(--bark))" : "hsl(var(--ink-deep))",
              }}
            >
              <span className="relative inline-flex">
                <ShieldAlert className="h-5 w-5" strokeWidth={adminActive ? 2.3 : 1.8} />
              </span>
              <span className="flex-1 text-ds-14 font-semibold">Admin</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${adminOpen ? "rotate-180" : ""}`}
                strokeWidth={2.25}
                aria-hidden
              />
            </button>

            {adminOpen && (
              <ul id="side-panel-admin-sections" className="mt-1 space-y-2 pb-1">
                {adminNavGroups.map((group) => (
                  <li key={group.title}>
                    <p
                      className="px-3 pt-1 pb-0.5 text-ds-10 font-semibold uppercase tracking-[0.08em]"
                      style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                    >
                      {group.title}
                    </p>
                    <ul>
                      {group.items.map(({ id, label, icon: ItemIcon }) => {
                        const on = adminActive && currentAdminView === id;
                        return (
                          <li key={id}>
                            <button
                              onClick={() => navigate(`/admin?view=${id}`)}
                              aria-current={on ? "page" : undefined}
                              // Indented to the parent's icon column, so the
                              // nesting reads structurally rather than needing
                              // a rule or a box.
                              className="flex w-full items-center gap-2.5 rounded-ds-md py-1.5 pl-11 pr-3 text-left text-ds-12 transition-colors hover:bg-[hsl(var(--bark)/0.06)]"
                              style={{
                                background: on ? "hsl(var(--bark) / 0.08)" : "transparent",
                                color: on ? "hsl(var(--bark))" : "hsl(var(--ink-deep) / 0.78)",
                                fontWeight: on ? 700 : 500,
                              }}
                            >
                              <ItemIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={on ? 2.3 : 1.8} />
                              <span className="truncate">{label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>

    </nav>
  );
};

export default DesktopSidebarNav;
