import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, forwardRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";

const Navbar = forwardRef<HTMLElement>((_props, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav
      ref={ref}
      className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/30"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="container mx-auto flex items-center justify-between h-14 px-4"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md transition-transform duration-200 group-hover:scale-105">
            <span className="text-primary-foreground font-bold text-sm">H</span>
          </div>
          <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Helpr
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-6">
          <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            How it works
          </a>
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Features
          </a>
          <a href="#community" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Community
          </a>
          <Link to="/jobs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Jobs
          </Link>
          <Link to="/support" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Support
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="rounded-xl btn-press" onClick={() => navigate("/login")}>
              Log in
            </Button>
            <Button size="sm" className="rounded-xl btn-press" onClick={() => navigate("/signup")}>
              Get started
            </Button>
          </div>
        </div>

        {/* Mobile toggle */}
        <div className="lg:hidden flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="hover:bg-muted btn-press rounded-xl h-9 w-9"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="lg:hidden glass border-b border-border/30 px-4 pb-4 space-y-3"
          style={{
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
            paddingRight: "max(1rem, env(safe-area-inset-right))",
          }}
        >
          <a href="#how-it-works" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            How it works
          </a>
          <a href="#features" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            Features
          </a>
          <a href="#community" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            Community
          </a>
          <Link to="/jobs" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            Jobs
          </Link>
          <Link to="/support" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            Support
          </Link>
          <Button variant="ghost" size="sm" className="w-full rounded-xl" onClick={() => { navigate("/login"); setMobileOpen(false); }}>
            Log in
          </Button>
          <Button size="sm" className="w-full rounded-xl" onClick={() => { navigate("/signup"); setMobileOpen(false); }}>
            Get started
          </Button>
        </div>
      )}
    </nav>
  );
});
Navbar.displayName = "Navbar";

export default Navbar;
