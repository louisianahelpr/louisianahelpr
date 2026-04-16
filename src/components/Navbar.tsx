import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, forwardRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";

const Navbar = forwardRef<HTMLElement>((_props, ref) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav ref={ref} className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="text-2xl font-display font-bold text-primary tracking-tight">
          Helpr
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-8">
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
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
            Log in
          </Button>
          <Button size="sm" onClick={() => navigate("/signup")}>
            Get started
          </Button>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-background border-b border-border px-4 pb-4 space-y-3">
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
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => { navigate("/login"); setMobileOpen(false); }}>
            Log in
          </Button>
          <Button size="sm" className="w-full" onClick={() => { navigate("/signup"); setMobileOpen(false); }}>
            Get started
          </Button>
        </div>
      )}
    </nav>
  );
});
Navbar.displayName = "Navbar";

export default Navbar;
