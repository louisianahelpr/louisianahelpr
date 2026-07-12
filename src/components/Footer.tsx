import { Link } from "react-router-dom";
import { Apple, Heart, Mail, MapPin } from "lucide-react";

// Inline Facebook glyph — lucide-react v1.x removed brand icons including
// `Facebook`. Inlining the standard "f" mark keeps the social link working
// without pinning lucide back to 0.x.
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

// Inline Instagram glyph — lucide-react v1.x removed brand icons. Simple
// square-outline with the dot and lens; matches the visual weight of the
// Facebook "f" mark next to it.
const Instagram = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
  </svg>
);

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";
const INSTAGRAM_URL = "https://www.instagram.com/louisianahelpr";

/**
 * Editorial footer — matches the landing hero's parchment surface, no
 * card panels, quiet Heritage Gold section labels. Store badges live
 * here (relocated from the nav) — Google Play shows a "Coming soon"
 * state until the Android app ships.
 */
const Footer = () => (
  <footer
    className="px-5 sm:px-8 lg:px-12 relative border-t border-[hsl(var(--olivewood))]/15"
    style={{
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      backdropFilter: "blur(20px) saturate(170%)",
      WebkitBackdropFilter: "blur(20px) saturate(170%)",
      color: "hsl(var(--olivewood))",
    }}
  >
    <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] pt-6 md:pt-8 pb-3 md:pb-4">
      <div className="grid gap-6 md:gap-8 md:grid-cols-12">
        {/* Brand */}
        <div className="md:col-span-4 space-y-3">
          <Link
            to="/"
            className="inline-flex items-baseline gap-2 text-ds-24 font-serif font-extrabold tracking-[-0.025em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Helpr
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

        {/* Follow — App Store icon (download) + Facebook + Instagram (socials).
            Compact squircle chips, one row. */}
        <div className="md:col-span-2">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--heritage-gold))" }}
          >
            Follow
          </h3>
          {/* Three uniform editorial chips — all olivewood-fill squircles
              with parchment icons. No clashing brand colors; the row
              reads as one coherent set instead of three loud logos. */}
          <div className="flex items-center gap-2">
            {[
              {
                href: APP_STORE_URL,
                label: "Download on the App Store",
                Icon: Apple,
                iconProps: { strokeWidth: 1.5, fill: "currentColor" as const },
              },
              {
                href: FACEBOOK_URL,
                label: "Follow us on Facebook",
                Icon: Facebook,
                iconProps: { strokeWidth: 1.5, fill: "currentColor" as const },
              },
              {
                href: INSTAGRAM_URL,
                label: "Follow us on Instagram",
                Icon: Instagram,
                iconProps: {},
              },
            ].map(({ href, label, Icon, iconProps }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-300 ease-out hover:-translate-y-0.5"
                style={{
                  background: "hsl(var(--olivewood))",
                  color: "hsl(var(--parchment))",
                  boxShadow:
                    "inset 0 1px 0 hsl(var(--parchment) / 0.15), 0 1px 2px rgba(0,0,0,0.06), 0 6px 16px -6px hsl(var(--olivewood) / 0.35)",
                }}
                aria-label={`${label} (opens in a new tab)`}
                title={label}
              >
                <Icon
                  className="h-[17px] w-[17px] transition-transform duration-300 group-hover:scale-110"
                  {...iconProps}
                />
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: copyright */}
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-[hsl(var(--olivewood))]/15">
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
