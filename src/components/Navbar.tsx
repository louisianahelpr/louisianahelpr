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
import { sectionIsComingSoon, useSectionsOpen } from "@/components/landing/useSectionsOpen";

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
   * The landing page's bar (owner-approved redesign, 2026-10-20): the wordmark,
   * Jobs / Declutter (only once its switch is open to everyone) / How it works
   * from md, then Log in and "Join free". Every other public page keeps the
   * default bar.
   */
  landing?: boolean;
}

const Navbar = forwardRef<HTMLElement, NavbarProps>(({ solid = false, landing = false }, ref) => {
  // Session-only auth (no profile DB round-trip) so the marketing nav can
  // reflect logged-in state: an authenticated visitor landing on a public
  // page (/legal, /) should see an "Open app" CTA instead of
  // the logged-out "Log in / Get Started" pair.
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
  const getStartedTo = location.pathname === "/browse" ? "/signup" : "/browse";
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
        // olive "Get Started" button and the dark emblem bled a green cast up
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
        {landing ? (
          <span className="shrink-0 whitespace-nowrap">
            <HelprMark to="/" size="md" hideEmblem />
          </span>
        ) : (
          <HelprMark to="/" size="md" emblemOnly />
        )}
        {/* Smooth-scroll-to-top behavior on the marketing root used to
            live inline on this Link; HelprMark handles routing but if
            we want the same behavior in the future, replace with a
            local onClick wrapper. */}

        {/* ONE nav at every width — text links, a subtle divider, then the auth
            actions. There is no hamburger below lg any more (owner). It opened a
            sheet whose contents were Jobs, Log In, Get Started and a list of
            links the footer already carries in full — a second copy of the site
            index behind an extra tap. The three things that matter fit the bar
            on a phone, so they sit in it. */}
        <div className={cn("flex items-center gap-4 sm:gap-6 lg:gap-10", landing && "gap-2 sm:gap-6")}>
          {/* "How it works" removed (owner). It pointed at /#how-it-works — an
              ANCHOR on the landing page, not a page. From /login or /jobs it
              threw you off the page you were on and onto the homepage before
              scrolling, so the same nav item behaved differently depending on
              where you stood. The landing page still carries that section in
              its own reading order, and the Help Center covers the explaining
              job for everyone else. */}
          {/* "Jobs" removed from the nav (owner). It's still reachable — the
              footer's Company column links to it, and "Browse Jobs" is a
              primary hero CTA — so this is one fewer top-level item competing
              with the two actions the bar actually exists to drive: Log In /
              Get Started. */}
          {/* Subtle vertical rule between text nav and auth actions —
              two logical groups rather than one long list. Rendered only when
              there ARE auth actions beside it: a signed-in visitor now gets
              nothing in this group (see below), so an unconditional rule left
              a hairline floating alone at the end of the bar. */}
          {landing && <LandingNavLinks />}
          {!user && (
            <span
              aria-hidden
              className={cn("w-px h-5", landing && "hidden md:block")}
              style={{ background: "hsl(var(--olivewood) / 0.18)" }}
            />
          )}
          <div className="flex items-center gap-2">
            {/* NOTHING for a signed-in visitor (owner, 2026-08-30: "delete
                globally"). This used to be a "Dashboard →" CTA. A signed-in
                person on a public page already has the app's own navigation —
                the desktop sidebar rail (DesktopSidebarNav, which carries
                Home / Posts / Jobs / Messages / Profile) on web and the bottom
                nav on a phone — so this button was a second, redundant way
                back into an app they are already inside, and the only one of
                the two that named just one destination. */}
            {!user && (
              <>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className={cn("rounded-2xl btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]", landing && "rounded-full")}
                >
                  <Link
                    to="/login"
                    onMouseEnter={() => prefetchRoute("/login")}
                    onFocus={() => prefetchRoute("/login")}
                  >
                    {landing ? "Log in" : "Log In"}
                  </Link>
                </Button>
                {/* "Get Started" — explicit light-cream text. The `default`
                    variant nominally resolves text-primary-foreground →
                    --parchment, but that two-hop token chain has repeatedly
                    rendered dark-on-olive in the WebView. Pin the color
                    locally — `!text-...` on the button itself plus a
                    belt-and-braces inline style — so it can never lose the
                    cascade, independent of variant token resolution. */}
                <Button
                  asChild
                  size="sm"
                  className={cn("rounded-2xl btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]", landing && "rounded-full px-5")}
                  style={{ color: "hsl(var(--parchment))" }}
                >
                  {/* Browse first (owner, 2026-10-09): Get Started opens the
                      job list, no account needed; sign-up is asked for at
                      Apply or Post. ON the job list it is the sign-up, so it
                      never links to the page already open. */}
                  <Link
                    to={landing ? "/signup" : getStartedTo}
                    onMouseEnter={() => prefetchRoute(landing ? "/signup" : getStartedTo)}
                    onFocus={() => prefetchRoute(landing ? "/signup" : getStartedTo)}
                  >
                    {landing ? "Join free" : "Get Started"}
                  </Link>
                </Button>
              </>
            )}
          </div>

        </div>

      </div>
    </nav>
  );
});
Navbar.displayName = "Navbar";

/**
 * The landing bar's text links, from md. Its own component so only the landing
 * reads the sections answer (React Query): every other public page's bar stays
 * free of it. Cache-only (never fetches): the sections block asks once it is on
 * screen; until that answer is in, Declutter stays out of the bar (fails closed).
 */
function LandingNavLinks() {
  const { open } = useSectionsOpen(false);
  const declutterOpen = !sectionIsComingSoon("declutter", open);
  const cls = "inline-flex items-center min-h-11 transition-opacity hover:opacity-70";
  return (
    <div className="hidden md:flex items-center gap-7 text-ds-15 font-semibold" style={{ color: "var(--lp-ink)" }}>
      <Link to="/browse" className={cls}>Jobs</Link>
      {declutterOpen && (
        <Link to="/signup?redirect=%2Fdeclutter" className={cls}>Declutter</Link>
      )}
      <a href="#how-it-works" className={cls}>How it works</a>
    </div>
  );
}

export default Navbar;
