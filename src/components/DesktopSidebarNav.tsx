import { useEffect, useState } from "react";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useLocation, useNavigate } from "react-router-dom";
import {
  User,
  ShieldAlert,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useSectionTabs, comingSoonLabel, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { dockItems, type DockItem } from "@/components/mobileNav/dockItems";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { useAdminBadges } from "@/components/admin/adminBadgeStore";
import { useSidePanel } from "@/components/sidePanelOpen";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";
import { prefetchRoute } from "@/lib/routePrefetch";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";

/**
 * DesktopSidebarNav — the persistent RIGHT-rail navigation shown ONLY on the
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
 * The destinations are the dock's own list (Home, the member's sections,
 * Messages) plus Profile (Q2220). It reuses the same badge sources MobileNav uses so the
 * unread/activity counts stay consistent across the two navs.
 */

const PROFILE_ITEM = { path: "/profile", icon: User, label: "Profile" };

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
  // Render nothing unless we're on the wide desktop website. This is the same
  // gate as the `web-desktop` <html> class, so the rail and the CSS that
  // insets the shell turn on/off together. It sits in front of every hook the
  // rail calls: below 900px the rail can never show, and its reads (the
  // feature_enabled_for RPC of each hidden-switch destination above all) went
  // out on every phone page load for nothing (a11y-webkit-prod 38911703338,
  // nightly-red #2375: x386 at 375 with one switch; 39167774119 read
  // feature_enabled_for x1503 over 448 tests with three). Guard:
  // src/test/desktopRailReadsOnlyOnDesktop.test.tsx.
  const isWebDesktop = useIsWebDesktop();
  if (!isWebDesktop) return null;
  return <DesktopSidebarRail />;
};

const DesktopSidebarRail = () => {
  const { open: sidePanelOpen } = useSidePanel();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useCurrentUser();
  // Declutter (docs/specs/declutter-auctions.md row 1: its own tab) joins the
  // destinations after Messages only while the hidden switch is on for this
  // member; for everyone else the panel is unchanged.
  // Shops (docs/specs/local-shops-prep.md L1-L2) follows it, and Homes (the
  // 'rentals' switch; owner 2026-10-18: the nav says Homes) follows Shops:
  // the dock's section tabs, read from the same hook so the two cannot drift.
  const sectionTabs = useSectionTabs();
  // Customize (owner, 2026-10-19): a section the member hid leaves the rail too.
  const { visible: visibleSections } = useSectionPrefs();
  // ONE PLACE FOR EACH THING (Q2220, dashboards build run 4): the rail is the
  // dock's own list (Home, the member's shown sections in their order, with
  // Posts living inside Jobs, then Messages) plus Profile. No separate Posts row
  // and no "Post a Job" button: Jobs' "+" is in its top bar. A section switched
  // off for this viewer is listed greyed and says "coming soon".
  const navItems: Array<{ path: string; icon: LucideIcon; label: string; badgeKey?: DockItem["badgeKey"]; comingSoon?: boolean }> = [
    ...dockItems(sectionTabs, visibleSections),
    PROFILE_ITEM,
  ];
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
  // The SAME shared store MobileNav reads (Q103): one unread query and one
  // realtime channel per user, however many navs are mounted.
  const { unreadCount } = useNavUnreadCount(user);
  // AM-011: /admin's queue counts (published by Admin.tsx from getBadge).
  const adminBadges = useAdminBadges();
  const adminTotal = Object.values(adminBadges).reduce((a, n) => a + n, 0);

  if (!isDesktopRailRoute(location.pathname)) return null;
  // The rail is authed app chrome — its destinations are ProtectedRoutes. On a
  // guest-reachable rail route (e.g. /browse, which redirects authed users to
  // /home, so its visitor is ALWAYS logged out) rendering the rail would
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

  const badgeFor = (key?: DockItem["badgeKey"]) => {
    if (key === "messages") return unreadCount;
    if (key === "posts") return postsCount;
    if (key === "jobs") return jobsCount;
    if (key === "jobsAndPosts") return postsCount + jobsCount;
    return 0;
  };

  // Jobs is active on /jobs and on /posts (which forwards to Jobs > Posted).
  const isActive = (path: string) => location.pathname === path || (path === "/jobs" && location.pathname === "/posts");

  return (
    <nav
      aria-label="Primary"
      aria-hidden={!sidePanelOpen}
      // @ts-expect-error — `inert` is valid HTML; React's types lag it.
      inert={!sidePanelOpen ? "" : undefined}
      className={`fixed right-0 bottom-0 z-40 hidden lg:flex lg:flex-col motion-safe:transition-[transform,visibility] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] ${
        sidePanelOpen ? "visible" : "invisible"
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
        // Aligns with the TOP OF THE LEFT CARD, not with the header.
        // Measured at 908x994: the frame starts at y=56 and carries lg:pt-5,
        // so the content card starts at y=76 — the panel was at y=64 and stood
        // 12px taller than the thing beside it (owner: "the right panel and
        // left panel should be the same height"). 3.5rem clears the header,
        // 1.25rem is that same lg:pt-5.
        // TRAVEL THE SAME DISTANCE AS THE CONTENT EDGE, so the two read as one
        // movement (owner: "left panel opens faster than right panel moves
        // out"). Duration and curve already matched at 300ms; the DISTANCE did
        // not. Tailwind's `translate-x-full` moves the panel by its OWN width —
        // 236px after the 12px inset — while the frame's `right` changes by the
        // full 248px rail width. Same time, different distance, so they drifted
        // apart mid-slide; and the 12px shortfall also left a sliver of panel
        // parked on screen when closed.
        transform: sidePanelOpen
          ? "translateX(0)"
          : "translateX(var(--desktop-sidebar-w, 248px))",
        top: "calc(var(--safe-area-top, 0px) + 3.5rem + 1.25rem)",
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


      {/* Destinations */}
      {/* SCROLLS. The panel had no overflow handling at all, which was fine
          while it held six fixed rows — and stopped being fine the moment
          Admin nested twenty-four sections under itself: everything past the
          fold was simply unreachable (owner: "right panel doesn't allow scroll
          for admin").
          `min-h-0` is the load-bearing half. A flex child defaults to
          min-height:auto, so it refuses to shrink below its content and
          `overflow-y-auto` never has anything to scroll — the list just grows
          past the bottom of the panel instead. */}
      <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-3 py-2">
        {navItems.map((item) => {
          const { path, icon: Icon, label } = item;
          const badgeKey = "badgeKey" in item ? item.badgeKey : undefined;
          const soon = "comingSoon" in item && !!item.comingSoon;
          const active = !soon && isActive(path);
          const count = soon ? 0 : badgeFor(badgeKey);
          return (
            <li key={path}>
              <button
                onClick={() => (soon ? sayComingSoon(label) : navigate(path))}
                onMouseEnter={() => !soon && prefetchRoute(path)}
                aria-current={active ? "page" : undefined}
                aria-disabled={soon ? true : undefined}
                aria-label={soon ? comingSoonLabel(label) : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-ds-md px-3 py-2.5 text-left transition-colors${soon ? " cursor-not-allowed" : ""}`}
                style={{
                  background: active ? "hsl(var(--bark) / 0.08)" : "transparent",
                  color: active ? "hsl(var(--bark))" : soon ? "hsl(var(--muted-foreground))" : "hsl(var(--ink-deep))",
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
                  className="font-sans text-ds-15"
                  style={{ fontWeight: active ? 700 : 500 }}
                >
                  {label}
                </span>
                {soon && (
                  <span aria-hidden className="ml-auto font-sans text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
                    Soon
                  </span>
                )}
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
                {!adminOpen && adminTotal > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-ds-10 font-bold"
                    style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
                  >
                    {adminTotal > 9 ? "9+" : adminTotal}
                  </span>
                )}
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
                      style={{
                        // 0.70, not 0.65. These four section headers repeat on
                        // every admin screen, so a single 0.03 miss became 96
                        // of the failures the five-leg sweep found — the
                        // largest cluster in the app by node count and one of
                        // the smallest by cause. 0.65 measured 4.47:1 against
                        // 4.5 required at 10px; 0.70 measures 5.18:1.
                        color: "hsl(var(--olivewood) / 0.7)",
                      }}
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
                              className="flex w-full items-center gap-2.5 rounded-ds-md py-1.5 pl-11 pr-3 text-left text-ds-12 ctl-tint"
                              style={{
                                background: on ? "hsl(var(--bark) / 0.08)" : "transparent",
                                color: on ? "hsl(var(--bark))" : "hsl(var(--ink-deep) / 0.78)",
                                fontWeight: on ? 700 : 500,
                              }}
                            >
                              <ItemIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={on ? 2.3 : 1.8} />
                              <span className="truncate">{label}</span>
                              {!!adminBadges[id] && (
                                <>
                                  <span
                                    className="ml-auto flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-ds-10 font-bold"
                                    style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
                                    aria-hidden="true"
                                  >
                                    {adminBadges[id] > 99 ? "99+" : adminBadges[id]}
                                  </span>
                                  <span className="sr-only">{`${adminBadges[id]} new`}</span>
                                </>
                              )}
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
