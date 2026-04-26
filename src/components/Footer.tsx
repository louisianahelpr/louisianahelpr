import { Link } from "react-router-dom";
import { Apple, Facebook, Heart, Mail, MapPin } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const Footer = () => (
  <footer className="border-t border-border py-16 md:py-20 px-4">
    <div className="container mx-auto max-w-6xl">
      {/* Main grid: editorial layout — wide brand + 3 tight link columns */}
      <div className="grid gap-12 md:gap-10 lg:gap-14 md:grid-cols-12">
        {/* Brand block — wider, breathes more */}
        <div className="md:col-span-5 space-y-5">
          <Link to="/" className="inline-block text-2xl font-display font-bold text-primary tracking-tight">
            Helpr
          </Link>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            Hire a Helpr or find local work — your trusted Louisiana partner for everyday tasks.
          </p>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground pt-1">
            <a
              href="mailto:admin@louisianahelpr.com"
              className="inline-flex items-center gap-2 hover:text-primary transition-colors w-fit"
            >
              <Mail className="w-3.5 h-3.5" />
              admin@louisianahelpr.com
            </a>
            <span className="inline-flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              Serving all of Louisiana
            </span>
          </div>

          {/* Social buttons — side by side under brand */}
          <div className="flex flex-wrap gap-2.5 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-4 text-background shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
              aria-label="App Store — Download Helpr (opens in a new tab)"
            >
              <Apple className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
              <span className="text-left leading-tight">
                <span className="block text-[8px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
                <span className="block text-xs font-semibold tracking-tight">App Store</span>
              </span>
            </a>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-[hsl(var(--facebook))] px-4 text-white shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
              aria-label="Facebook — Follow Helpr (opens in a new tab)"
            >
              <Facebook className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
              <span className="text-left leading-tight">
                <span className="block text-[8px] font-medium uppercase tracking-[0.18em] opacity-80">Follow us on</span>
                <span className="block text-xs font-semibold tracking-tight">Facebook</span>
              </span>
            </a>
          </div>
        </div>

        {/* Link columns — 3 tight columns, balanced */}
        <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-6 lg:gap-10">
          {/* Company */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-4 uppercase tracking-wider">Company</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link to="/features" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link to="/community" className="hover:text-primary transition-colors">Community</Link></li>
              <li><Link to="/heroes" className="hover:text-primary transition-colors">Heroes</Link></li>
              <li><Link to="/for-business" className="hover:text-primary transition-colors">Business</Link></li>
            </ul>
          </div>

          {/* Legal & pricing */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-4 uppercase tracking-wider">Legal</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link to="/rules" className="hover:text-primary transition-colors">Pricing & Fees</Link></li>
              <li><Link to="/rules" className="hover:text-primary transition-colors">Platform Rules</Link></li>
              <li><Link to="/terms" className="hover:text-primary transition-colors">Terms</Link></li>
              <li><Link to="/privacy" className="hover:text-primary transition-colors">Privacy</Link></li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-4 uppercase tracking-wider">Support</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link to="/support" className="hover:text-primary transition-colors">Help Center</Link></li>
              <li><Link to="/support" className="hover:text-primary transition-colors">Contact Us</Link></li>
              <li><a href="mailto:admin@louisianahelpr.com" className="hover:text-primary transition-colors">Email Us</a></li>
            </ul>
          </div>
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
