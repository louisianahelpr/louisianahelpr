import { useLocation, useNavigate } from "react-router-dom";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import NotificationPanel from "@/components/notificationPanel/NotificationBell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";
import { DeliveryOnlinePill } from "@/components/declutter/DeliveryOnlinePill";
import { DESKTOP_BAR_PAD_TOP } from "@/lib/desktopBar";
import { HelpEntry } from "@/components/help/HelpEntry";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";

/**
 * The signed-in app bar for the DESKTOP WEBSITE: the notification bell and the
 * member's photo at the right (board 11), spanning the content area beside the LEFT sidebar (which carries the
 * logo since 2026-10-20, board 11).
 *
 * Rendered ONCE, globally, from App.tsx beside {@link DesktopSidebarNav}, and
 * gated on the identical three conditions that component uses:
 *
 *   isWebDesktop && isDesktopRailRoute(pathname) && !!user
 *
 * Rendering it globally rather than per-page is deliberate. It was previously
 * threaded through AppShell's `header` slot page by page, which meant every
 * screen had to opt in individually — so Home and Activity had a bar while
 * Profile, Messages and /user/:id did not, and any page added later would
 * start life without one. Worse, `/user/:id` is a document-scroll page that
 * never mounts AppShell at all, so it had no `header` slot to opt into. One
 * global render is the only version that stays true as pages are added.
 *
 * NATIVE AND PHONE WEB ARE UNTOUCHED. `useIsWebDesktop` is
 * `!isNativePlatform() && matchMedia('(min-width: 900px)')`, so the native
 * iOS/Android shell fails it even on a wide iPad, and phone-width browsers
 * fail it too — both keep the chrome they already had (MobileNav plus each
 * screen's own title card). This must never be gated with a bare Tailwind
 * `lg:` utility: `lg:` is pure CSS width and would fire inside a wide native
 * WebView, putting a web app bar in the native app.
 *
 * Renders no heading element. The emblem's accessible name comes from its
 * image `alt`, so the page below keeps exactly one `<h1>`.
 */
const DesktopTopNav = () => {
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  // The fixed OfflineBanner (top 0, 32px) sat OVER this bar at 1440 and clipped the page title: measured offline at
  // 1440, banner bottom 31.9 vs the "Jobs" h1 top 28.4 (B44 10-31). AppShell already starts its frame at banner + bar,
  // so the bar moves down by the same banner offset. 0 while the banner is hidden. Guard: src/test/offlineBannerOverDesktopBar.test.ts.
  const bannerOffset = useOfflineBannerOffset();

  if (!isWebDesktop) return null;
  if (!isDesktopRailRoute(location.pathname)) return null;
  if (!user) return null;

  return (
    <header
      // data-rail-inset: the LEFT sidebar is always open and carries the logo
      // (board 11, 2026-10-20), so this bar spans only the content beside it
      // and holds the bell. No hamburger: the sidebar never closes.
      data-rail-inset=""
      className="fixed top-0 left-0 right-0 z-50 glass-nav"
      style={{
        // Blur only, no saturate() — saturate on a backdrop filter amplifies
        // the colour of whatever scrolls beneath the bar, which read as a
        // green cast shifting under the nav on the marketing header.
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        // The row (h-14) sits 14px down, so its middle is the rail logo's middle (src/lib/desktopBar.ts).
        paddingTop: DESKTOP_BAR_PAD_TOP,
        top: bannerOffset,
      }}
    >
      <div className="w-full flex h-14 items-center justify-end gap-2 px-5 lg:px-6 xl:px-6">
        {/* ONE header row (owner, 2026-10-21): the page's back arrow, title and
            actions (PageTitleBar) are portaled here, left of the bell and photo,
            so a page never adds a second row under this bar. */}
        <div ref={registerDesktopTitleSlot} data-desktop-title-slot="" className="flex-1 min-w-0 flex items-center" />
        <div className="flex items-center gap-1.5 -mr-1 [&_button]:h-11 [&_button]:w-11">
          {/* Q2440: shown only while the member is online for deliveries. */}
          <DeliveryOnlinePill placement="header" />
          {/* UX-6: the one Help entry, left of the bell. */}
          <HelpEntry />
          <NotificationPanel />
          {/* Board 11: bell, then the member's photo (opens You). */}
          <Button
            type="button"
            variant="ghost"
            size="iconCompact"
            aria-label="Profile"
            data-testid="desktop-top-profile"
            onClick={() => navigate("/profile")}
          >
            <UserAvatar userId={user.id} src={profile?.avatar_url} name={profile?.full_name} pixelSize={72} alt="" className="w-9 h-9" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default DesktopTopNav;
