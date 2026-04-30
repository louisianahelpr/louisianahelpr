import { Link, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, forwardRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { prefetchRoute } from "@/lib/routePrefetch";
import helprIcon from "@/assets/helpr-icon-96.png";

const Navbar = forwardRef<HTMLElement>((_props, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
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
      className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/30 bg-background/80"
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
        className="w-full flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8"
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
          <img
            src={helprIcon}
            alt="Helpr"
            width={36}
            height={36}
            fetchPriority="high"
            decoding="async"
            className="w-9 h-9 rounded-xl shadow-md transition-transform duration-200 group-hover:scale-105"
          />
          <span className="text-2xl font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent leading-none">
            Helpr
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-6">
          <Link to="/#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-sans">
            How it works
          </Link>
          <Link to="/#open-jobs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Jobs
          </Link>
          <Link to="/for-business" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Business
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="rounded-xl btn-press" onClick={() => navigate("/login")} onMouseEnter={() => prefetchRoute("/login")} onFocus={() => prefetchRoute("/login")}>
              Log in
            </Button>
            <Button size="sm" className="rounded-xl btn-press" onClick={() => navigate("/signup")} onMouseEnter={() => prefetchRoute("/signup")} onFocus={() => prefetchRoute("/signup")}>
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
            <SheetContent side="right" className="w-[280px] sm:w-[320px] p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 pb-4 border-b border-border/40">
                <img src={helprIcon} alt="Helpr" className="w-8 h-8 rounded-lg" />
                <span className="text-xl font-display font-bold text-primary">Helpr</span>
              </div>
              <Link
                to="/#how-it-works"
                className="block text-base font-medium text-foreground py-3 border-b border-border/30 min-h-[44px] flex items-center"
                onClick={() => setMobileOpen(false)}
              >
                How it works
              </Link>
              <Link
                to="/#open-jobs"
                className="block text-base font-medium text-foreground py-3 border-b border-border/30 min-h-[44px] flex items-center"
                onClick={() => setMobileOpen(false)}
              >
                Jobs
              </Link>
              <Link
                to="/for-business"
                className="block text-base font-medium text-foreground py-3 border-b border-border/30 min-h-[44px] flex items-center"
                onClick={() => setMobileOpen(false)}
              >
                For Business
              </Link>
              <div className="flex flex-col gap-3 mt-auto pt-4">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full rounded-xl"
                  onClick={() => { navigate("/login"); setMobileOpen(false); }}
                >
                  Log in
                </Button>
                <Button
                  size="lg"
                  className="w-full rounded-xl"
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
