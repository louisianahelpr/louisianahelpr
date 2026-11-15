import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { registerDesktopTitleSlot } from "@/components/header/desktopTitleSlot";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DESKTOP_BAR_PAD_TOP } from "@/lib/desktopBar";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";

/**
 * The desktop website's top bar frame while DesktopTopNav's own chunk is still on its way: the same fixed glass bar
 * (classes, blur, top padding and banner offset copied from DesktopTopNav's <header>) with the page-title slot on the
 * left; the bell, Help and photo arrive with the chunk.
 *
 * Why the pending frame (Q169, prod-audit 43691657529 on 2026-11-15 page-settle @1440): a page that rendered before the bar's
 * chunk found no slot, drew its phone title row (about 81px), then dropped it when the bar mounted, and the whole
 * body jumped up. Every Profile tab measured 0.034-0.044 that way, /post-job 0.038. With the slot there from the
 * first paint, the page's title goes straight into the bar and the body never moves.
 * Guard: src/test/desktopTitleSlotBeforeBarChunk.test.tsx.
 */
function DesktopTopBarFrame({ children }: { children?: ReactNode }) {
  // The fixed OfflineBanner sat OVER this bar at 1440 and clipped the page title (B44 10-31): the bar moves down by
  // the banner's offset (0 while the banner is hidden). Guard: src/test/offlineBannerOverDesktopBar.test.ts.
  const bannerOffset = useOfflineBannerOffset();
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
        {children}
      </div>
    </header>
  );
}

/**
 * DesktopTopNav's Suspense fallback: the same frame, on the same routes and for the same signed-in member the bar
 * itself shows for (DesktopTopNav returns nothing otherwise), with the bell and photo still to come.
 * Rendered inside WebDesktopOnly, so a phone never draws it.
 */
export function DesktopTopBarPending() {
  const { pathname } = useLocation();
  const { user } = useCurrentUser();
  if (!user || !isDesktopRailRoute(pathname)) return null;
  return <DesktopTopBarFrame />;
}
