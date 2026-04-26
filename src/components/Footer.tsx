import { Link } from "react-router-dom";
import { Apple, Facebook, Heart, Mail, MapPin } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const Footer = () => (
  <footer className="border-t border-border py-16 md:py-20 px-4">
    <div className="container mx-auto">
      {/* Main grid: brand + Company + Legal & Pricing + Connect */}
      <div className="grid gap-10 md:gap-8 md:grid-cols-12">
        {/* Brand block */}
        <div className="md:col-span-4 space-y-4">
          <Link to="/" className="text-xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="text-sm text-muted-foreground max-w-[16rem] leading-relaxed">
            Hire a Helpr or find local work.
            <br />
            Your trusted Louisiana partner
            <br />
            for everyday tasks.
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
        <div className="md:col-span-2">
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
        <div className="md:col-span-3">
          <h3 className="text-sm font-semibold text-foreground mb-3">Legal & Pricing</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/rules" className="hover:text-primary transition-colors">Pricing & Fees</Link></li>
            <li><Link to="/rules" className="hover:text-primary transition-colors">Platform Rules</Link></li>
            <li><Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
            <li><Link to="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
          </ul>
        </div>

        {/* Connect with us */}
        <div className="md:col-span-3 md:text-right">
          <h3 className="text-sm font-semibold text-foreground mb-3">Connect with us</h3>
          <ul className="space-y-2.5 text-sm flex flex-col md:items-end">
            <li>
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-11 w-44 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-background shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
                aria-label="App Store — Download Helpr (opens in a new tab)"
              >
                <Apple className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
                <span className="ml-auto text-right leading-tight">
                  <span className="block text-[8px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
                  <span className="block text-xs font-semibold tracking-tight">App Store</span>
                </span>
              </a>
            </li>
            <li>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-11 w-44 items-center justify-center gap-2 rounded-lg bg-[hsl(var(--facebook))] px-4 text-white shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
                aria-label="Facebook — Follow Helpr (opens in a new tab)"
              >
                <Facebook className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
                <span className="ml-auto text-right leading-tight">
                  <span className="block text-[8px] font-medium uppercase tracking-[0.18em] opacity-80">Follow us on</span>
                  <span className="block text-xs font-semibold tracking-tight">Facebook</span>
                </span>
              </a>
            </li>
          </ul>
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
