import { Link } from "react-router-dom";
import { Apple, Heart, Mail, MapPin } from "lucide-react";

// Inline Facebook glyph — lucide-react v1.x removed brand icons including
// `Facebook`. Inlining the standard "f" mark keeps the social link working
// without pinning lucide back to 0.x. Sized + styled via className/props
// to match the previous <Facebook> usage.
const Facebook = ({ className, strokeWidth, fill }: { className?: string; strokeWidth?: number; fill?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill={fill ?? "currentColor"}
    stroke="currentColor"
    strokeWidth={strokeWidth ?? 1.5}
    aria-hidden="true"
  >
    <path d="M14 13.5h2.5l1-4H14V7c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z" />
  </svg>
);

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

/**
 * Signature footer — Jasper Green ground with Heritage Gold category titles
 * and white links. Multi-column dense layout to keep the vertical footprint
 * tight. Reads as the closing seal of the page rather than a utility strip.
 */
const Footer = () => (
  <footer
    className="px-5 sm:px-8 lg:px-12 relative border-t border-[hsl(var(--olivewood))]/15"
    style={{
      /* Floating-glass footer — minimal tint, blur-only, NO horizontal line.
         The page's mesh gradient flows continuously into the footer area
         so there's no visible cut between page and footer. */
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      backdropFilter: "blur(20px) saturate(170%)",
      WebkitBackdropFilter: "blur(20px) saturate(170%)",
      color: "hsl(var(--olivewood))",
    }}
  >
    <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] pt-7 md:pt-9 pb-3 md:pb-4">
      <div className="grid gap-8 md:gap-10 md:grid-cols-12">
        {/* Brand */}
        <div className="md:col-span-4 space-y-3">
          <Link
            to="/"
            className="inline-flex items-baseline gap-2 text-ds-24 font-serif font-extrabold tracking-[-0.025em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Helpr
            {/* "· LA" gold echo of the wax-seal monogram. Gives the brand mark
                a second appearance at the bottom of the page, tying the
                hero seal to the footer wordmark. */}
            <span
              className="text-ds-15 font-serif font-bold tracking-[0.05em]"
              style={{ color: "hsl(var(--heritage-gold) / 0.7)" }}
              aria-hidden
            >
              · LA
            </span>
          </Link>
          <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-sm leading-relaxed">
            Hire a Helpr or find local work — your trusted Louisiana partner for
            everyday jobs.
          </p>
          <div className="flex flex-col gap-1.5 text-ds-11 text-[hsl(var(--olivewood))]/80 pt-1">
            <a
              href="mailto:admin@louisianahelpr.com"
              className="inline-flex items-center gap-2 link-standard w-fit"
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

        {/* Company */}
        <div className="md:col-span-3">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Company
          </h3>
          <ul className="space-y-2 text-ds-11 text-[hsl(var(--olivewood))]/85">
            <li>
              <Link to="/for-business" className="link-standard">
                Business
              </Link>
            </li>
            <li>
              <Link to="/subscription" className="link-standard">
                Membership
              </Link>
            </li>
            <li>
              <Link to="/help" className="link-standard">
                Help Center
              </Link>
            </li>
          </ul>
        </div>

        {/* Legal */}
        <div className="md:col-span-3">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Legal
          </h3>
          <ul className="space-y-2 text-ds-11 text-[hsl(var(--olivewood))]/85">
            <li>
              <Link to="/terms" className="link-standard">
                Terms
              </Link>
            </li>
            <li>
              <Link to="/rules" className="link-standard">
                Rules
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="link-standard">
                Privacy
              </Link>
            </li>
          </ul>
        </div>

        {/* Connect */}
        <div className="md:col-span-2">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Connect
          </h3>
          <div className="flex items-center gap-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5"
              aria-label="Download on the App Store (opens in a new tab)"
              title="Download on the App Store"
            >
              <Apple
                className="h-[15px] w-[15px] transition-transform duration-300 group-hover:scale-110"
                strokeWidth={1.5}
                fill="currentColor"
              />
            </a>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--facebook))] text-white shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5"
              aria-label="Follow us on Facebook (opens in a new tab)"
              title="Follow us on Facebook"
            >
              <Facebook
                className="h-[15px] w-[15px] transition-transform duration-300 group-hover:scale-110"
                strokeWidth={1.5}
                fill="currentColor"
              />
            </a>
          </div>
        </div>
      </div>

      {/* Motto — EB Garamond italic. Print-era flourish that establishes the
          "established institution" feel above the standard copyright row. */}
      <p
        className="mt-6 text-center font-serif italic text-ds-13 sm:text-ds-15"
        style={{
          color: "hsl(var(--heritage-gold))",
          fontWeight: 400,
          letterSpacing: "0.02em",
        }}
      >
        Serving Louisiana since 2026.
      </p>

      {/* Bottom: copyright */}
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 border-t border-[hsl(var(--olivewood))]/15">
        <p className="text-ds-11 text-[hsl(var(--olivewood))]/80">
          © {new Date().getFullYear()} Helpr LLC. All rights reserved. · Louisiana, USA
        </p>
        <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 flex items-center gap-1.5">
          Made with{" "}
          <Heart
            className="w-3 h-3"
            style={{
              color: "hsl(var(--heritage-gold))",
              fill: "hsl(var(--heritage-gold))",
            }}
          />{" "}
          for Louisiana communities
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
