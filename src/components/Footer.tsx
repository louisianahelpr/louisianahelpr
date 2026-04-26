import { Link } from "react-router-dom";
import { Apple, Facebook, Heart, Mail, MapPin } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto space-y-8">
      {/* Top: brand + service description + app actions */}
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


      {/* App Store + Facebook actions — directly above the divider */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex h-12 w-full sm:w-[190px] items-center justify-center gap-2.5 rounded-xl bg-foreground px-5 py-2.5 text-background shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.4)] ring-1 ring-foreground/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-10px_hsl(var(--foreground)/0.6)]"
          aria-label="Download Helpr on the App Store"
        >
          <Apple className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
          <span className="text-left leading-tight">
            <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
            <span className="block text-sm font-semibold tracking-tight">App Store</span>
          </span>
        </a>
        <a
          href={FACEBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex h-12 w-full sm:w-[190px] items-center justify-center gap-2.5 rounded-xl bg-[#0d4a8f] px-5 py-2.5 text-white shadow-[0_8px_24px_-8px_rgba(13,74,143,0.4)] ring-1 ring-white/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#0a3a72] hover:shadow-[0_16px_36px_-10px_rgba(13,74,143,0.6)]"
          aria-label="Follow Helpr on Facebook"
        >
          <Facebook className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
          <span className="text-left leading-tight">
            <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Follow us on</span>
            <span className="block text-sm font-semibold tracking-tight">Facebook</span>
          </span>
        </a>
      </div>

      {/* Bottom: copyright */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/50 pt-6">
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
