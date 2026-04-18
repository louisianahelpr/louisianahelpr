import { Link } from "react-router-dom";
import { Heart } from "lucide-react";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link to="/" className="text-xl font-display font-bold text-primary">
          Helpr
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <a href="/#community" className="hover:text-primary transition-colors">Community</a>
          <Link to="/community-values" className="hover:text-primary transition-colors">Our Values</Link>
          <Link to="/heroes" className="hover:text-primary transition-colors">Heroes</Link>
          <Link to="/rules" className="hover:text-primary transition-colors">Rules</Link>
          <Link to="/terms" className="hover:text-primary transition-colors">Terms</Link>
          <Link to="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
          <Link to="/support" className="hover:text-primary transition-colors">Support</Link>
        </div>
        <div className="text-center sm:text-right">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Helpr. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Proudly serving Louisiana communities
          </p>
        </div>
      </div>
      <div className="text-center border-t border-border/50 pt-4">
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
          Made with <Heart className="w-3.5 h-3.5 text-primary fill-primary" /> by the Helpr community — thank you for being part of something special
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
