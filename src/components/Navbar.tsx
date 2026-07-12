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
        className="w-full flex items-center justify-between h-12
          pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]
          sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))]
          lg:pl-[max(3rem,env(safe-area-inset-left))] lg:pr-[max(3rem,env(safe-area-inset-right))]"
      >
        {/* Use the shared HelprMark so the public Navbar wordmark
            ("Helpr · LA") matches the authenticated DashboardHeader
            and the signup AuthShell. Single source of truth, single
            on-brand presentation. */}
        <HelprMark to="/" size="md" />
        {/* Smooth-scroll-to-top behavior on the marketing root used to
            live inline on this Link; HelprMark handles routing but if
            we want the same behavior in the future, replace with a
            local onClick wrapper. */}

        {/* Desktop nav links — Charcoal default, Heritage Gold on hover.
            Single state now that the page has a solid surface behind the
            nav (no more photo bleeding under it). */}
        <div className="hidden lg:flex items-center gap-12">
          <Link
            to="/#how-it-works"
            className="text-ds-13 font-sans font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            How it works
          </Link>
          <Link
            to="/#jobs"
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
          <div className="flex items-center gap-1">
            {/* App Store download — compact nav chip. The phones / hero copy
                carry the marketplace pitch; the download lives here so it's a
                persistent, conventional affordance on every marketing page
                rather than an orphan tile in the hero. */}
            <a
              href="https://apps.apple.com/us/app/helpr/id6754470134"
              target="_blank"
              rel="noopener noreferrer"
              className="liquid-glass mr-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full transition-transform duration-200 hover:-translate-y-0.5"
              style={{ color: "hsl(var(--ink-deep))" }}
              aria-label="Download Helpr on the App Store"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden>
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              <span className="font-sans font-semibold text-ds-13">App Store</span>
            </a>
            {user ? (
              // Authenticated visitor on a public/marketing page — send them
              // back into the app instead of showing logged-out auth CTAs.
              <Button
                asChild
                size="sm"
                className="rounded-full btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
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
                  className="rounded-full btn-press transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
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
                  className="rounded-full btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
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

        {/* Mobile toggle */}
        <div className="lg:hidden flex items-center gap-1">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                className="btn-press rounded-full h-8 px-3 gap-1.5 font-sans font-semibold text-ds-13"
                style={{
                  background: "hsl(0 0% 100% / 0.2)",
                  border: "1px solid hsl(var(--olivewood) / 0.08)",
                  boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.3)",
                  color: "hsl(var(--bark))",
                }}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
              >
                {mobileOpen ? <X className="w-4 h-4" strokeWidth={2.25} /> : <Menu className="w-4 h-4" strokeWidth={2.25} />}
                Menu
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
                to="/#jobs"
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
