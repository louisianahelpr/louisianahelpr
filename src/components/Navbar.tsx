import { Link, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, useEffect, forwardRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { prefetchRoute } from "@/lib/routePrefetch";
import helprLogoSm from "@/assets/helpr-logo-96.webp";
import helprLogoMd from "@/assets/helpr-logo-256.webp";
const helprLogoSrc = helprLogoSm;
import { cn } from "@/lib/utils";

const Navbar = forwardRef<HTMLElement>((_props, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  // Toggle the Heritage Gold border-bottom + linen surface once the user
  // scrolls past the immersive hero. While at the top of the page, the nav
  // stays fully transparent so the photo flows uninterrupted.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // On iOS Capacitor we ship with `overlaysWebView: false` + `contentInset:
  // 'always'`, so the WebView already starts BELOW the status bar. Adding
  // another 1rem of padding-top here pushes the logo way down (visible on
  // TestFlight as a giant gap above the header). On the web — where the
  // browser owns the status bar — keep the breathing room so the logo isn't
  // flush against notch insets reported by mobile Safari.
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();

  return (
    <nav
      ref={ref}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 glass-nav transition-[border-color,background-color,box-shadow] duration-300",
        scrolled && "is-scrolled",
      )}
      style={{
        // On native iOS the WebView already sits below the status bar
        // (overlaysWebView: false + contentInset: 'always'), so we add
        // ZERO extra top padding — anything more creates a visible gap
        // between the status bar and the Helpr logo.
        paddingTop: isNative
          ? "0px"
          : "max(env(safe-area-inset-top), 0.25rem)",
      }}
    >
      <div
        className="w-full flex items-center justify-between h-12 px-4 sm:px-6 lg:px-8"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <Link
          to="/"
          className="flex items-center gap-2 group"
          onClick={(e) => {
            if (window.location.pathname === "/") {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
        >
          <img loading="lazy" decoding="async"
            src={helprLogoSrc}
            srcSet={`${helprLogoSm} 96w, ${helprLogoMd} 256w`}
            sizes="28px"
            alt="Helpr"
            className="h-7 w-auto select-none transition-transform duration-200 group-hover:scale-105"
            style={{ filter: "drop-shadow(0 1px 1px rgba(46, 47, 34, 0.18)) drop-shadow(0 2px 6px rgba(46, 47, 34, 0.1))" }}
            draggable={false}
          />
          <span
            className="text-[1.6rem] font-serif italic tracking-[-0.005em] leading-none"
            style={{
              fontWeight: 500,
              color: "hsl(var(--ink-deep))",
              textShadow: "0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            Helpr
          </span>
        </Link>

        {/* Desktop nav links — Charcoal default, Heritage Gold on hover.
            Single state now that the page has a solid surface behind the
            nav (no more photo bleeding under it). */}
        <div className="hidden lg:flex items-center gap-12">
          <Link
            to="/#how-it-works"
            className="text-sm font-sans font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            How it works
          </Link>
          <Link
            to="/#open-jobs"
            className="text-sm font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            Jobs
          </Link>
          <Link
            to="/for-business"
            className="text-sm font-semibold text-[hsl(var(--ink-deep))] transition-colors duration-200 hover:text-[hsl(var(--heritage-gold))]"
          >
            Business
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl btn-press"
              onClick={() => navigate("/login")}
              onMouseEnter={() => prefetchRoute("/login")}
              onFocus={() => prefetchRoute("/login")}
            >
              Log in
            </Button>
            <Button
              size="sm"
              className="rounded-xl btn-press"
              onClick={() => navigate("/signup")}
              onMouseEnter={() => prefetchRoute("/signup")}
              onFocus={() => prefetchRoute("/signup")}
            >
              Get started
            </Button>
          </div>
        </div>

        {/* Mobile toggle */}
        <div className="lg:hidden flex items-center gap-1">
          <ThemeToggle />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted btn-press rounded-xl h-10 w-10"
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
                <img loading="lazy" decoding="async"
                  src={helprLogoMd}
                  alt="Helpr"
                  className="h-7 w-auto select-none"
                  style={{ filter: "drop-shadow(0 1px 1px rgba(46, 47, 34, 0.18)) drop-shadow(0 2px 6px rgba(46, 47, 34, 0.1))" }}
                  draggable={false}
                />
                <span
                  className="text-2xl font-serif italic tracking-[-0.005em]"
                  style={{ fontWeight: 500, color: "hsl(var(--ink-deep))" }}
                >
                  Helpr
                </span>
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
                to="/#open-jobs"
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
                  variant="outline"
                  size="lg"
                  className="liquid-glass w-full rounded-2xl font-sans font-semibold"
                  style={{
                    color: "hsl(var(--olivewood))",
                    border: "1px solid hsla(0,0%,100%,0.6)",
                  }}
                  onClick={() => { navigate("/login"); setMobileOpen(false); }}
                >
                  Log in
                </Button>
                <Button
                  size="lg"
                  className="btn-liquid-fill w-full rounded-2xl font-sans font-semibold"
                  style={{
                    color: "hsl(var(--parchment))",
                    backgroundColor: "hsl(var(--sage))",
                    border: "1px solid hsl(var(--sage))",
                    boxShadow:
                      "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
                  }}
                  onClick={() => { navigate("/signup"); setMobileOpen(false); }}
                >
                  Get started
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
