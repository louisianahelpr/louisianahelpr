import { Link } from "react-router-dom";
import { Apple, Facebook, Heart, Mail, MapPin } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const Footer = () => (
  <footer className="border-t border-border py-16 md:py-20 px-4">
    <div className="container mx-auto">
      {/* Top: brand + service description + link columns */}
      <div className="grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2 space-y-4">
          <Link to="/" className="text-xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="text-sm text-muted-foreground max-w-md">
            Hire a Helpr or find local work. Your trusted Louisiana partner for everyday tasks.
          </p>
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            <a
              href="mailto:admin@louisianahelpr.com"
              className="flex items-center gap-2 hover:text-primary transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              admin@louisianahelpr.com
            </a>
            <span className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              Serving all of Louisiana
            </span>
          </div>
        </div>

        {/* Company */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Company</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/features" className="hover:text-primary transition-colors">Features</Link></li>
            <li><Link to="/community" className="hover:text-primary transition-colors">Community</Link></li>
            <li><Link to="/heroes" className="hover:text-primary transition-colors">Heroes</Link></li>
            <li><Link to="/for-business" className="hover:text-primary transition-colors">Business</Link></li>
            <li><Link to="/support" className="hover:text-primary transition-colors">Contact / Support</Link></li>
          </ul>
        </div>

        {/* Legal & pricing */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Legal & Pricing</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/rules" className="hover:text-primary transition-colors">Pricing & Fees</Link></li>
            <li><Link to="/rules" className="hover:text-primary transition-colors">Platform Rules</Link></li>
            <li><Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
            <li><Link to="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
          </ul>
        </div>
      </div>

      {/* Sub-footer: Download (left) + Connect (right) — ghost-button styling */}
      <div className="mt-20 grid gap-10 md:grid-cols-2 md:gap-8">
        <div className="flex flex-col items-center md:items-start gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Download
          </span>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-4 text-foreground transition-all duration-300 ease-out hover:border-foreground/40 hover:bg-foreground/[0.03]"
            aria-label="App Store — Download Helpr (opens in a new tab)"
          >
            <Apple className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            <span className="text-left leading-tight">
              <span className="block text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Download on the</span>
              <span className="block text-xs font-semibold tracking-tight">App Store</span>
            </span>
          </a>
        </div>

        <div className="flex flex-col items-center md:items-end gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Connect with us
          </span>
          <a
            href={FACEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-4 text-foreground transition-all duration-300 ease-out hover:border-[hsl(var(--facebook))] hover:text-[hsl(var(--facebook))] hover:bg-[hsl(var(--facebook)/0.04)]"
            aria-label="Facebook — Follow Helpr (opens in a new tab)"
          >
            <Facebook className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} />
            <span className="text-left leading-tight">
              <span className="block text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Follow us on</span>
              <span className="block text-xs font-semibold tracking-tight">Facebook</span>
            </span>
          </a>
        </div>
      </div>

      {/* Bottom: copyright */}
      <div className="mt-16 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/50 pt-6">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Helpr LLC. All rights reserved. · Louisiana, USA
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          Made with <Heart className="w-3 h-3 text-primary fill-primary" /> for Louisiana communities
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
