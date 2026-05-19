import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, useEffect, forwardRef } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { prefetchRoute } from "@/lib/routePrefetch";
import HelprMark from "@/components/HelprMark";
import { cn } from "@/lib/utils";

const Navbar = forwardRef<HTMLElement>((_props, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Toggle the Heritage Gold border-bottom + linen surface once the user
  // scrolls past the immersive hero. While at the top of the page, the nav
  // stays fully transparent so the photo flows uninterrupted.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav
      ref={ref}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 glass-nav transition-[border-color,background-color,box-shadow] duration-300",
        scrolled && "is-scrolled",
      )}
      style={{
        // The iOS Capacitor WebView is edge-to-edge (`overlaysWebView: true`
        // in capacitor.config.ts + setOverlaysWebView({overlay:true}) in
        // nativeInit.ts), so the status bar overlaps the WebView on every
        // platform. Pad by the safe-area top inset (clamped to 0.25rem so the
        // logo isn't flush on browsers that report a zero inset).
        paddingTop: "max(env(safe-area-inset-top), 0.25rem)",
      }}
    >
      <div
        className="w-full flex items-center justify-between h-12 px-4 sm:px-6 lg:px-8"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
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
            to="/browse"
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
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-ds-md btn-press"
            >
              <Link
                to="/login"
                onMouseEnter={() => prefetchRoute("/login")}
                onFocus={() => prefetchRoute("/login")}
              >
                Log in
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="rounded-ds-md btn-press"
            >
              <Link
                to="/signup"
                onMouseEnter={() => prefetchRoute("/signup")}
                onFocus={() => prefetchRoute("/signup")}
              >
                Get started
              </Link>
            </Button>
          </div>
        </div>

        {/* Mobile toggle */}
        <div className="lg:hidden flex items-center gap-1">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted btn-press rounded-ds-md h-10 w-10"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[280px] sm:w-[320px] p-6 flex flex-col gap-2"
              style={{
                backgroundColor: "hsl(var(--parchment))",
                color: "hsl(var(--olivewood))",
              }}
            >
              <div
                className="flex items-center gap-2 pb-5 mb-2"
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
                className="block font-sans font-semibold py-3 min-h-[44px] flex items-center transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                How it works
              </Link>
              <Link
                to="/browse"
                className="block font-sans font-semibold py-3 min-h-[44px] flex items-center transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                Jobs
              </Link>
              <Link
                to="/for-business"
                className="block font-sans font-semibold py-3 min-h-[44px] flex items-center transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
                style={{
                  fontSize: "1rem",
                  color: "hsl(var(--ink-deep))",
                  borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
                onClick={() => setMobileOpen(false)}
              >
                For Business
              </Link>
              <div className="flex flex-col gap-3 mt-auto pt-6">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="liquid-glass w-full rounded-2xl font-sans font-semibold"
                  style={{
                    color: "hsl(var(--olivewood))",
                    border: "1px solid hsla(0,0%,100%,0.6)",
                  }}
                >
                  <Link to="/login" onClick={() => setMobileOpen(false)}>
                    Log in
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  className="btn-liquid-fill w-full rounded-2xl font-sans font-semibold"
                  style={{
                    color: "hsl(var(--parchment))",
                    backgroundColor: "hsl(var(--sage))",
                    border: "1px solid hsl(var(--sage))",
                    boxShadow:
                      "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
                  }}
                >
                  <Link to="/signup" onClick={() => setMobileOpen(false)}>
                    Get started
                  </Link>
                </Button>
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
