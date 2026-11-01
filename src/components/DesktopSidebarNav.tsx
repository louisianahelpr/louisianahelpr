import { useState } from "react";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  ChevronDown,
  Plus,
  type LucideIcon,
} from "lucide-react";
import HelprMark from "@/components/HelprMark";
import { CreateSheet } from "@/components/create/CreateSheet";
import { leftItems, rightItems, exploreItem, youItem } from "@/components/mobileNav/mobileNavHelpers";
import { useSectionTabs, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import type { DockItem } from "@/components/mobileNav/dockItems";
import { announceTabReselect } from "@/components/mobileNav/tabReselect";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { useAdminBadges } from "@/components/admin/adminBadgeStore";
import { ADMIN_QUEUE_IDS, adminBadgeFor, adminPendingTotal, useAdminPendingCounts } from "@/components/admin/adminRailBadges";
import { safeStorage } from "@/lib/safeStorage";
import { useSidePanel } from "@/components/sidePanelOpen";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { useNeedsYouCounts } from "@/lib/needsYouStore";
import { prefetchRoute } from "@/lib/routePrefetch";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { SoonPill } from "@/components/sections/SoonPill";
import { PreviewPill } from "@/components/sections/PreviewPill";
import { useLanguage } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";

/**
 * DesktopSidebarNav — the persistent LEFT sidebar (owner 2026-10-19: left and
 * always open; board 11, HELPR-DESIGN-SPEC v2 §4.4) shown ONLY on the
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
 * Top to bottom (board 11): the logo, an olive "Create" pill that opens the
 * same create sheet as the phone's center +, Home, Explore with the member's
 * sections nested under it (Customize order; a closed section reads "Soon"),
 * Messages, You. No hamburger: it never closes. It reuses the same badge sources MobileNav uses so the
 * unread/activity counts stay consistent across the two navs.
 */

/** This device's remembered open/closed choice for the Admin group ("0" = the admin collapsed it). */
const ADMIN_NAV_OPEN_KEY = "helpr_admin_nav_open";

type NavRow = { path: string; icon: LucideIcon; label: string; badgeKey?: DockItem["badgeKey"]; comingSoon?: boolean; preview?: boolean; nested?: boolean };

/**
 * Admin — the SAME five destinations for everyone, plus one expandable group
 * for the accounts that have it (owner: "the side panel should be identical to
 * a non-admin user, just add the admin sections under the Admin in the
 * sidebar").
 *
 * Nested rather than flat because admin is not a sixth peer of Home/Posts/Jobs
 * — it is a console with twenty-odd sections of its own. OPEN by default for an
 * admin (owner, 2026-10-27: "Maybe for the admin stuff leave it open on the
 * left panel", after a waiting report and six tickets went unnoticed), and the
 * admin's own collapse choice is remembered on this device (ADMIN_NAV_OPEN_KEY).
 * Each queue row carries its open count in red, and the Admin row carries the
 * total, the way Explore carries its sections' total, so it shows collapsed too.
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
  // Spanish option (2026-10-29): the rail's words come from the dictionary.
  const { t: tr } = useLanguage();
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
  const { visible: shownSections } = useSectionPrefs();
  // The rail is web-only today (isNativePlatform never shows it), but if it ever renders in the iPhone app a
  // section not open to everyone is left out there (owner 10-31, src/lib/hideUnopenedInApp.ts).
  const visibleSections = shownSections.filter((sec) => sectionTabs.find((x) => x.path === sec.path)?.listed !== false);
  // ONE PLACE FOR EACH THING (Q2220, dashboards build run 4): the rail is the
  // dock's own list (Home, the member's shown sections in their order, with
  // Posts living inside Jobs, then Messages) plus Profile. No separate Posts row
  // and no "Post a Job" button: Jobs' "+" is in its top bar. A section switched
  // off for this viewer is listed greyed and says "coming soon".
  const [createOpen, setCreateOpen] = useState(false);
  // BADGE = TO-DO (owner, 2026-10-20): the counts NeedsYouBridge publishes from Home's list.
  const todo = useNeedsYouCounts(user?.id);
  // The SAME shared store MobileNav reads (Q103): one unread query and one
  // realtime channel per user, however many navs are mounted.
  const { unreadCount } = useNavUnreadCount(user);
  const messages = rightItems.find((i) => i.path === "/messages")!;
  const navItems: NavRow[] = [
    leftItems[0],
    exploreItem,
    ...visibleSections.map((sec) => {
      const t = sectionTabs.find((x) => x.path === sec.path);
      // Jobs and Shops carry their share of the To-do count (Explore's badge is the total); Declutter and Homes have no to-dos yet, so none is shown.
      const badgeKey = sec.key === "jobs" ? ("todoJobs" as const) : sec.key === "shops" ? ("todoShops" as const) : undefined;
      return { path: sec.path, icon: sec.icon, label: sec.label, nested: true, comingSoon: t ? !t.on : false, preview: t ? t.preview : false, badgeKey };
    }),
    { path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" },
    youItem,
  ];

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
    if (key === "todo") return todo.total;
    if (key === "todoJobs") return todo.jobs;
    if (key === "todoShops") return todo.shops;
    return 0;
  };

  // Jobs is active on /jobs and on /posts (which forwards to Jobs > Posted).
  const inSection = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`) || (path === "/jobs" && location.pathname.startsWith("/posts"));
  const isActive = (path: string) =>
    path === "/explore"
      ? location.pathname === "/explore" || visibleSections.some((sec) => inSection(sec.path))
      : inSection(path);

  return (
    <nav
      aria-label={tr("nav.primary")}
      aria-hidden={!sidePanelOpen}
      // @ts-expect-error — `inert` is valid HTML; React's types lag it.
      inert={!sidePanelOpen ? "" : undefined}
      data-desktop-sidebar="left"
      className={`fixed left-0 top-0 bottom-0 z-40 hidden lg:flex lg:flex-col ${sidePanelOpen ? "visible" : "invisible"}`}
      style={{
        width: "var(--desktop-sidebar-w, 248px)",
        paddingTop: "var(--safe-area-top, 0px)",
        background: "hsl(var(--card))",
        borderRight: "1px solid hsl(var(--border))",
      }}
    >
      {/* The logo sits 20px down (a 44px box, middle at 42px) and the top bar's row is centred on that same 42px
          (src/lib/desktopBar.ts), so the page title reads level with the H (owner 2026-10-28: "move the job title
          down so it's even with the H logo"; the title moves, not the logo). Create's middle (104px) is the section
          tabs row's. Guard: src/test/desktopHeadLevelWithRail.test.ts. */}
      <div className="px-5 pt-5 pb-4 shrink-0">
        <HelprMark to="/home" size="md" emblemOnly />
      </div>
      <div className="px-3 pb-3 shrink-0">
        <button
          type="button"
          data-testid="sidebar-create"
          aria-haspopup="dialog"
          aria-expanded={createOpen}
          onClick={() => setCreateOpen(true)}
          className="btn-grad-primary btn-press w-full h-12 rounded-full inline-flex items-center justify-center gap-2 text-ds-15 font-semibold"
        >
          <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          {tr("nav.create")}
        </button>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-3 py-2">
        {navItems.map((item) => {
          const { path, icon: Icon, label } = item;
          const shownKey = navKey(path, label);
          const shown = shownKey ? tr(shownKey) : label;
          const badgeKey = "badgeKey" in item ? item.badgeKey : undefined;
          const soon = "comingSoon" in item && !!item.comingSoon;
          const preview = !soon && "preview" in item && !!item.preview;
          const active = !soon && isActive(path);
          const count = soon ? 0 : badgeFor(badgeKey);
          return (
            <li key={path}>
              <button
                onClick={() => { if (soon) return sayComingSoon(label); if (location.pathname === path) announceTabReselect(path); navigate(path); }}
                onMouseEnter={() => !soon && prefetchRoute(path)}
                aria-current={active ? "page" : undefined}
                aria-disabled={soon ? true : undefined}
                aria-label={soon ? tr("nav.comingSoon", { label: shown }) : undefined}
                data-sidebar-item={path}
                className={`group relative flex w-full items-center gap-3 rounded-full ${item.nested ? "pl-9 pr-3 py-2" : "px-3 py-2.5"} text-left transition-colors${soon ? " cursor-not-allowed" : ""}`}
                style={{
                  // Only the current page gets the pill; Explore is bold when one of its sections is open.
                  background: active && (item.nested || path !== "/explore" || location.pathname === "/explore") ? "hsl(var(--bark) / 0.10)" : "transparent",
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
                      data-sidebar-badge
                      className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-ds-10 font-bold"
                      style={{
                        // Count badges are --alert, never rust (spec v2 §1.1).
                        background: "hsl(var(--alert))",
                        color: "#fff",
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
                  {shown}
                  {/* Audit #42: a closed section says "Coming soon" under its name, as the phone chips do. */}
                  {soon && <SoonPill variant="rail" aria-hidden="true" />}
                  {/* A2-L17: a tester's open section says "Coming soon" too (olive), as the phone's chips do. */}
                  {preview && <PreviewPill variant="rail" />}
                </span>
              </button>
            </li>
          );
        })}

        {/* ADMIN — one row for admins, its sections nested under it. Its own
            component, so only an admin's nav mounts the queue-count reads. */}
        {isAdmin && <AdminNavGroup />}
      </ul>

      {/* Mounted only once asked for: the sheet reads whether the member has a shop, and a page load should not. */}
      {createOpen && <CreateSheet open={createOpen} onOpenChange={setCreateOpen} />}
    </nav>
  );
};

/** The Admin row and its sections (admins only). */
const AdminNavGroup = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Admin's own sections: open unless this admin collapsed them on this device.
  const adminActive = location.pathname === "/admin";
  const currentAdminView = new URLSearchParams(location.search).get("view") || "home";
  const [adminOpen, setAdminOpenState] = useState(() => safeStorage.getItem(ADMIN_NAV_OPEN_KEY) !== "0");
  const toggleAdminOpen = () => {
    const next = !adminOpen;
    safeStorage.setItem(ADMIN_NAV_OPEN_KEY, next ? "1" : "0");
    setAdminOpenState(next);
  };
  // Every queue's open count, read here on EVERY page (an admin sees a waiting
  // ticket from Home), from the same hook as the Dashboard's Priority Alerts.
  // AM-011: /admin also publishes its "new since you looked" numbers (Jobs,
  // Referrals, Subscriptions), which adminBadgeFor uses for the other rows.
  const adminBadges = useAdminBadges();
  const pending = useAdminPendingCounts(true);
  const adminTotal = adminPendingTotal(pending.data);
  const adminRowBadge = (id: string) => adminBadgeFor(id, adminBadges, pending.data);

  return (
    <li className="mt-1">
      <button
        onClick={toggleAdminOpen}
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
          {adminTotal > 0 && (
            <span
              data-admin-total-badge={adminTotal}
              aria-hidden="true"
              className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-ds-10 font-bold"
              style={{ background: "hsl(var(--alert))", color: "#fff" }}
            >
              {adminTotal > 9 ? "9+" : adminTotal}
            </span>
          )}
        </span>
        <span className="flex-1 text-ds-14 font-semibold">Admin</span>
        {adminTotal > 0 && <span className="sr-only">{`${adminTotal} waiting`}</span>}
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
                        {(() => {
                          const n = adminRowBadge(id);
                          if (!n) return null;
                          return (
                            <>
                              <span
                                data-admin-badge={id}
                                className="ml-auto flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-ds-10 font-bold"
                                style={{ background: "hsl(var(--alert))", color: "#fff" }}
                                aria-hidden="true"
                              >
                                {n > 99 ? "99+" : n}
                              </span>
                              <span className="sr-only">{`${n} ${(ADMIN_QUEUE_IDS as readonly string[]).includes(id) ? "waiting" : "new"}`}</span>
                            </>
                          );
                        })()}
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
  );
};

export default DesktopSidebarNav;
