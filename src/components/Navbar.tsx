import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { forwardRef } from "react";
import { prefetchRoute } from "@/lib/routePrefetch";
import HelprMark from "@/components/HelprMark";
import { cn } from "@/lib/utils";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

interface NavbarProps {
  /**
   * Force the bordered/opaque "scrolled" chrome from the top of the page,
   * independent of scroll position. Interior pages (anything with a nav
   * spacer) opt in so the Heritage Gold hairline always marks where the
   * nav ends — otherwise the transparent nav has no visible bottom edge
   * against the page surface. The landing hero leaves this off so the nav
   * floats over the photo until the user scrolls.
   */
  solid?: boolean;
  /**
   * The landing page: the bar's row is centred at the landing's 78rem measure.
   * Its contents are the same bar as every other public page (owner,
   * 2026-10-21: "Jobs | Log in · Join free").
   */
  landing?: boolean;
}

const Navbar = forwardRef<HTMLElement, NavbarProps>(({ solid = false, landing = false }, ref) => {
  // Session-only auth (no profile DB round-trip) so the marketing nav can
  // reflect logged-in state: an authenticated visitor landing on a public
  // page (/legal, /) sees none of the signed-out "Jobs | Log in · Join free"
  // actions (see below).
  const { user } = useAuthReady();
  // On the wide desktop *website*, a signed-in visitor already has the
  // persistent RIGHT rail (DesktopSidebarNav) on app/marketing routes the rail
  // covers (e.g. /jobs, /browse). Showing this top marketing nav too would
  // stack two navs with a redundant "Open app" CTA — so step aside and let the
  // rail be the sole chrome. Guests keep the marketing nav (the rail's
  // destinations are all auth-gated), and the rail itself stays hidden on
  // native + narrow viewports, so this only suppresses the genuine overlap.
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const railOwnsNav = isWebDesktop && !!user && isDesktopRailRoute(location.pathname);
  // This nav is `position: fixed; top: 0`, so the global OfflineBanner (also
  // fixed at top:0) would overlay it. The `#root` padding that reserves space
  // for the banner on document-scroll pages can't move a fixed element, so
  // shift the nav's own top down by the banner's reserved height. 0 normally.
  const bannerOffset = useOfflineBannerOffset();

  if (railOwnsNav) return null;

  return (
    <nav
      ref={ref}
      aria-label="Primary"
      className={cn(
        "fixed top-0 left-0 right-0 z-50 glass-nav",
        solid && "is-scrolled",
      )}
      style={{
        // Subtle always-on backdrop blur so the nav reads as a floating
        // glass strip at every scroll position without triggering a
        // state change. Layers over the nav's existing bg (transparent
        // on landing, opaque on interior via is-scrolled).
        // Blur only — NO saturate(). `saturate()` on a backdrop filter
        // amplifies the colour of whatever passes beneath the bar, so the
        // olive "Join free" button and the dark emblem bled a green cast up
        // into the strip, and it shifted as the page scrolled under it. That is
        // the "green jumping shadow" and the "jumping colours": not a shadow at
        // all, but the nav re-saturating live content behind itself.
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        // The iOS Capacitor WebView is edge-to-edge (`overlaysWebView: true`
        // in capacitor.config.ts + setOverlaysWebView({overlay:true}) in
        // nativeInit.ts), so the status bar overlaps the WebView on every
        // platform. Pad by the safe-area top inset (clamped to 0.25rem so the
        // logo isn't flush on browsers that report a zero inset).
        paddingTop: "max(var(--safe-area-top, 0px), 0.25rem)",
        top: bannerOffset ? `${bannerOffset}px` : undefined,
      }}
    >
      <div
        className={cn(
          `w-full flex items-center justify-between h-[var(--public-nav-h)]
          pl-[max(1.25rem,var(--safe-area-left,0px))] pr-[max(1.25rem,var(--safe-area-right,0px))]
          sm:pl-[max(2rem,var(--safe-area-left,0px))] sm:pr-[max(2rem,var(--safe-area-right,0px))]
          lg:pl-[max(3rem,var(--safe-area-left,0px))] lg:pr-[max(3rem,var(--safe-area-right,0px))]`,
          landing && "max-w-[78rem] mx-auto",
        )}
      >
        {/* Emblem + wordmark on the MARKETING nav. This is the public,
            first-impression surface, and the wrought-iron H is the most
            distinctive part of the brand — it previously appeared only on
            the auth screens. The authed DashboardHeader deliberately stays
            wordmark-only (hideEmblem): in-app the user already knows where
            they are, and the top bar is tight on vertical space. */}
        {/* emblemOnly (owner): the crest alone, no "Helpr · LA" wordmark. The
            emblem keeps alt="Helpr", so the link's accessible name is unchanged
            — dropping the words must not drop the name. */}
        {/* The H logo on every bar, the landing's included (owner, 2026-10-20 08:30Z:
            never the "Helpr" wordmark). */}
        <HelprMark to="/" size="md" emblemOnly />
        {/* Smooth-scroll-to-top behavior on the marketing root used to
            live inline on this Link; HelprMark handles routing but if
            we want the same behavior in the future, replace with a
            local onClick wrapper. */}

        {/* ONE bar on every public page, the landing included (owner, 2026-10-21):
            signed out it reads "Jobs | Log in · Join free" at every width. "Jobs"
            is the public board (/browse) and "Join free" is sign-up (/signup) on
            every page; "Get started", "How it works" and the landing-only
            Declutter link are gone. There is no hamburger (owner): the three
            things that matter fit the bar on a phone.
            A signed-in visitor gets NOTHING here (owner, 2026-08-30: "delete
            globally"): the app's own navigation (the desktop rail, the bottom
            nav on a phone) already carries them. */}
        {!user && (
          <div className="flex items-center gap-1 sm:gap-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"
            >
              <Link
                to="/browse"
                aria-current={location.pathname === "/browse" ? "page" : undefined}
                onMouseEnter={() => prefetchRoute("/browse")}
                onFocus={() => prefetchRoute("/browse")}
              >
                Jobs
              </Link>
            </Button>
            {/* The divider between the public link and the auth actions. */}
            <span aria-hidden className="w-px h-5 mx-1" style={{ background: "hsl(var(--olivewood) / 0.18)" }} />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"
            >
              <Link
                to="/login"
                onMouseEnter={() => prefetchRoute("/login")}
                onFocus={() => prefetchRoute("/login")}
              >
                Log in
              </Link>
            </Button>
            {/* "Join free" — explicit light-cream text. The `default` variant
                nominally resolves text-primary-foreground → --parchment, but that
                two-hop token chain has repeatedly rendered dark-on-olive in the
                WebView. Pin the color locally — `!text-...` on the button itself
                plus a belt-and-braces inline style — so it can never lose the
                cascade, independent of variant token resolution. */}
            <Button
              asChild
              size="sm"
              className="rounded-full px-4 sm:px-5 btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
              style={{ color: "hsl(var(--parchment))" }}
            >
              <Link
                to="/signup"
                onMouseEnter={() => prefetchRoute("/signup")}
                onFocus={() => prefetchRoute("/signup")}
              >
                Join free
              </Link>
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
});
Navbar.displayName = "Navbar";

export default Navbar;
