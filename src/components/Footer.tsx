import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="border-t border-border py-12 px-4">
    <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <Link to="/" className="text-xl font-display font-bold text-primary">
        Helpr
      </Link>
      <p className="text-sm text-muted-foreground">
        © {new Date().getFullYear()} Helpr. All rights reserved.
      </p>
    </div>
  </footer>
);

export default Footer;
