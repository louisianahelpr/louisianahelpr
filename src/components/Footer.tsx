import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <Link to="/" className="text-xl font-display font-bold text-primary">
        Helpr
      </Link>
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
