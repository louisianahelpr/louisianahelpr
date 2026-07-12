import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X, Sparkles, Briefcase, Building2, ArrowRight } from "lucide-react";
import { useState, forwardRef } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { prefetchRoute } from "@/lib/routePrefetch";
import HelprMark from "@/components/HelprMark";
import { cn } from "@/lib/utils";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isDesktopRailRoute, useIsWebDesktop } from "@/components/DesktopSidebarNav";

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
}

const Navbar = forwardRef<HTMLElement, NavbarProps>(({ solid = false }, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Session-only auth (no profile DB round-trip) so the marketing nav can
  // reflect logged-in state: an authenticated visitor landing on a public
  // page (/for-business, /legal, /) should see an "Open app" CTA instead of
  // the logged-out "Log in / Get started" pair.
  const { user } = useAuthReady();
  // On the wide desktop *website*, a signed-in visitor already has the
  // persistent left rail (DesktopSidebarNav) on app/marketing routes the rail
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
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        // The iOS Capacitor WebView is edge-to-edge (`overlaysWebView: true`
        // in capacitor.config.ts + setOverlaysWebView({overlay:true}) in
        // nativeInit.ts), so the status bar overlaps the WebView on every
        // platform. Pad by the safe-area top inset (clamped to 0.25rem so the
        // logo isn't flush on browsers that report a zero inset).
        paddingTop: "max(env(safe-area-inset-top), 0.25rem)",
        top: bannerOffset ? `${bannerOffset}px` : undefined,
      }}
    >
      <div
        className="w-full flex items-center justify-between h-14 lg:h-16
          pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]
          sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))]
          lg:pl-[max(3rem,env(safe-area-inset-left))] lg:pr-[max(3rem,env(safe-area-inset-right))]"
      >
        {/* Use the shared HelprMark so the public Navbar wordmark
            ("Helpr · LA") matches the authenticated DashboardHeader
            and the signup AuthShell. Single source of truth, single
            on-brand presentation. */}
        <HelprMark to="/" size="md" hideEmblem />
        {/* Smooth-scroll-to-top behavior on the marketing root used to
            live inline on this Link; HelprMark handles routing but if
            we want the same behavior in the future, replace with a
            local onClick wrapper. */}

        {/* Desktop nav — text links, subtle vertical divider, then auth
            actions. Two visual groups instead of six things in a row. */}
        <div className="hidden lg:flex items-center gap-10">
          <Link
            to="/#how-it-works"
            className="text-ds-13 font-sans font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            How it works
          </Link>
          <Link
            to="/jobs"
            className="text-ds-13 font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            Jobs
          </Link>
          <Link
            to="/for-business"
            className="text-ds-13 font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            Business
          </Link>
          {/* Subtle vertical rule between text nav and auth actions —
              two logical groups rather than one long list. */}
          <span
            aria-hidden
            className="w-px h-5"
            style={{ background: "hsl(var(--olivewood) / 0.18)" }}
          />
          <div className="flex items-center gap-2">
            {user ? (
              // Authenticated visitor on a public/marketing page — send them
              // back into the app instead of showing logged-out auth CTAs.
              <Button
                asChild
                size="sm"
                className="rounded-2xl btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                style={{ color: "hsl(var(--parchment))" }}
              >
                <Link
                  to="/dashboard"
                  className="group"
                  onMouseEnter={() => prefetchRoute("/dashboard")}
                  onFocus={() => prefetchRoute("/dashboard")}
                >
                  Open app
                  <ArrowRight className="ml-1.5 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
                </Link>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="rounded-2xl btn-press transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                >
                  <Link
                    to="/login"
                    onMouseEnter={() => prefetchRoute("/login")}
                    onFocus={() => prefetchRoute("/login")}
                  >
                    Log in
                  </Link>
                </Button>
                {/* "Get started" — explicit light-cream text. The `default`
                    variant nominally resolves text-primary-foreground →
                    --parchment, but that two-hop token chain has repeatedly
                    rendered dark-on-olive in the WebView. Pin the color
                    locally — `!text-...` on the button itself plus a
                    belt-and-braces inline style — so it can never lose the
                    cascade, independent of variant token resolution. */}
                <Button
                  asChild
                  size="sm"
                  className="rounded-2xl btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                  style={{ color: "hsl(var(--parchment))" }}
                >
                  <Link
                    to="/signup"
                    onMouseEnter={() => prefetchRoute("/signup")}
                    onFocus={() => prefetchRoute("/signup")}
                  >
                    Get started
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Mobile cluster — a compact Get started CTA (guests, sm+ only,
            hidden at true-mobile), a subtle vertical divider, and the
            icon-only hamburger toggle. On phones only the hamburger
            shows so we don't crowd the narrow width. */}
        <div className="lg:hidden flex items-center gap-2 sm:gap-3">
          {!user && (
            <>
              <Button
                asChild
                size="sm"
                className="hidden sm:inline-flex rounded-2xl btn-press h-9 px-4 !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                style={{ color: "hsl(var(--parchment))" }}
              >
                <Link
                  to="/signup"
                  onMouseEnter={() => prefetchRoute("/signup")}
                  onFocus={() => prefetchRoute("/signup")}
                >
                  Get started
                </Link>
              </Button>
              <span
                aria-hidden
                className="hidden sm:block w-px h-5"
                style={{ background: "hsl(var(--olivewood) / 0.18)" }}
              />
            </>
          )}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="btn-press rounded-2xl h-9 w-9"
                style={{
                  background: "hsl(0 0% 100% / 0.2)",
                  border: "1px solid hsl(var(--olivewood) / 0.08)",
                  boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.3)",
                  color: "hsl(var(--bark))",
                }}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
              >
                {mobileOpen ? <X className="w-4 h-4" strokeWidth={2.25} /> : <Menu className="w-4 h-4" strokeWidth={2.25} />}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[280px] sm:w-[320px] p-6 flex flex-col gap-2"
              style={{
                backgroundColor: "hsl(var(--parchment))",
                color: "hsl(var(--olivewood))",
                // Push content below the status bar / dynamic island — the
                // sheet is full-height, so without the safe-area top inset the
                // HelprMark header clips behind the notch on iOS.
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)",
              }}
            >
              <div
                className="flex flex-col gap-1 pb-5 mb-2"
                style={{
                  borderBottom: "1px solid hsl(var(--burnt-sienna) / 0.4)",
                }}
              >
                {/* HelprMark again — to=null since we're inside a Sheet
                    and a Link would close the menu via navigation. */}
                <HelprMark to={null} size="md" />
              </div>
              <Link
                to="/#how-it-works"
                className="group font-sans font-semibold py-3 min-h-[44px] flex items-center gap-3 transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                <Sparkles className="w-[1.15rem] h-[1.15rem] shrink-0" strokeWidth={1.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
                How it works
              </Link>
              <Link
                to="/jobs"
                className="group font-sans font-semibold py-3 min-h-[44px] flex items-center gap-3 transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                <Briefcase className="w-[1.15rem] h-[1.15rem] shrink-0" strokeWidth={1.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
                Jobs
              </Link>
              <Link
                to="/for-business"
                className="group font-sans font-semibold py-3 min-h-[44px] flex items-center gap-3 transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                <Building2 className="w-[1.15rem] h-[1.15rem] shrink-0" strokeWidth={1.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
                Business
              </Link>
              <Link
                to="/subscription"
                className="group font-sans font-semibold py-3 min-h-[44px] flex items-center gap-3 transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                <Sparkles className="w-[1.15rem] h-[1.15rem] shrink-0" strokeWidth={1.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
                Membership
              </Link>
              <Link
                to="/help"
                className="group font-sans font-semibold py-3 min-h-[44px] flex items-center gap-3 transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                <Briefcase className="w-[1.15rem] h-[1.15rem] shrink-0" strokeWidth={1.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
                Help Center
              </Link>
              <div className="flex flex-col gap-3 mt-auto pt-6">
                {user ? (
                  // Authenticated visitor — single "Open app" CTA back into
                  // the dashboard instead of the logged-out Log in/Get started.
                  <Button
                    asChild
                    size="lg"
                    className="btn-liquid-fill group w-full rounded-2xl font-sans font-semibold !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                    style={{
                      color: "hsl(var(--parchment))",
                      backgroundColor: "hsl(var(--bark))",
                      backgroundImage: "none",
                      border: "1px solid hsl(var(--bark))",
                      boxShadow:
                        "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
                    }}
                  >
                    <Link to="/dashboard" onClick={() => setMobileOpen(false)}>
                      Open app
                      <ArrowRight className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
                    </Link>
                  </Button>
                ) : (
                  <>
                    {/* Get started = primary CTA (bark fill). Log in = quiet
                        secondary text link underneath so the two actions have
                        clearly different weight, not two competing pills. */}
                    <Button
                      asChild
                      size="lg"
                      className="btn-liquid-fill group w-full rounded-2xl font-sans font-semibold !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                      style={{
                        color: "hsl(var(--parchment))",
                        backgroundColor: "hsl(var(--bark))",
                        backgroundImage: "none",
                        border: "1px solid hsl(var(--bark))",
                        boxShadow:
                          "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
                      }}
                    >
                      <Link to="/signup" onClick={() => setMobileOpen(false)}>
                        Get started
                        <ArrowRight className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
                      </Link>
                    </Button>
                    <Link
                      to="/login"
                      onClick={() => setMobileOpen(false)}
                      className="text-center font-sans font-medium text-ds-13 mt-1 underline underline-offset-4 decoration-[hsl(var(--olivewood)/0.3)] hover:decoration-[hsl(var(--olivewood)/0.7)] transition-colors"
                      style={{ color: "hsl(var(--olivewood))" }}
                    >
                      Already have an account? Log in
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
});
Navbar.displayName = "Navbar";

export default Navbar;
