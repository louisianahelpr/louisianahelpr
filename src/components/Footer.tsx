import { Link } from "react-router-dom";
import { Heart, Mail, MapPin } from "lucide-react";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto space-y-8">
      {/* Top: brand + service description */}
      <div className="grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2 space-y-3">
          <Link to="/" className="text-xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="text-sm text-muted-foreground max-w-md">
            Louisiana's trusted marketplace connecting neighbors with verified local helpers
            for cleaning, yard work, moving, handyman tasks, errands, and more.
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
            <li><Link to="/heroes" className="hover:text-primary transition-colors">Heroes</Link></li>
            <li><a href="/#community" className="hover:text-primary transition-colors">Community</a></li>
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

      {/* Pricing disclosure strip — Stripe reviewer-friendly */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground text-center">
        <strong className="text-foreground">Transparent pricing:</strong> Posters pay a 10% service fee at checkout.
        Helprs receive 90% of the job budget (10% platform fee). Louisiana state and parish sales tax is collected
        on platform fees where applicable. <Link to="/rules" className="text-primary hover:underline">View full pricing →</Link>
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
