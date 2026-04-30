import { Link } from "react-router-dom";
import { Apple, Facebook, Heart, Mail, MapPin } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const Footer = () => (
  <footer className="border-t border-border py-14 md:py-16 px-4">
    <div className="container mx-auto max-w-5xl">
      {/* Top: brand + social side by side */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10 md:gap-8">
        {/* Brand block */}
        <div className="space-y-4 max-w-md">
          <Link to="/" className="inline-block text-2xl font-display font-bold text-primary tracking-tight">
            Helpr
          </Link>
          <p className="text-sm text-muted-foreground leading-relaxed">
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
        </div>

        {/* Social */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Get the app</h3>
          <div className="flex items-center gap-2.5">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
              aria-label="Download on the App Store (opens in a new tab)"
              title="Download on the App Store"
            >
              <Apple className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            </a>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--facebook))] text-white shadow-sm transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5"
              aria-label="Follow us on Facebook (opens in a new tab)"
              title="Follow us on Facebook"
            >
              <Facebook className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            </a>
          </div>
        </div>
      </div>

      {/* Middle: single inline link row */}
      <div className="mt-10 pt-8 border-t border-border/50">
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <Link to="/for-business" className="hover:text-primary transition-colors">Business</Link>
          <Link to="/support" className="hover:text-primary transition-colors">Contact / Support</Link>
          <Link to="/rules" className="hover:text-primary transition-colors">Rules & Pricing</Link>
          <Link to="/terms" className="hover:text-primary transition-colors">Terms</Link>
          <Link to="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
        </nav>
      </div>

      {/* Bottom: copyright */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
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
