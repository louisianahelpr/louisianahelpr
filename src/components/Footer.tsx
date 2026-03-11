import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <Link to="/" className="text-xl font-display font-bold text-primary">
        Helpr
      </Link>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
  </footer>
);

export default Footer;
