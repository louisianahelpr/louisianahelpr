import { Apple, Heart } from "lucide-react";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";
import { Link } from "react-router-dom";
import HelprMark from "@/components/HelprMark";

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
    <div className="page-measure pt-6 md:pt-8 pb-2">
      {/* Columns go side-by-side from sm (640px), not md (768px). At tablet
          widths the old md-only grid stacked brand + Company + Legal + Follow
          into ONE tall column, which made the footer dominate the page. From
          640px the brand takes the full row and the three link groups sit
          4/4/4 beside each other; md+ keeps the original 4/3/3/2 layout. */}
      {/* Base grid-cols-2 so the three link groups pair up below sm rather
          than stacking one-per-row. At ~400-640px that was four full-width
          blocks of vertical scroll for content that fits in two columns.
          The brand block spans both so its tagline keeps one measure. */}
      <div className="grid grid-cols-2 gap-6 min-[620px]:gap-x-4 min-[620px]:gap-y-6 md:gap-8 min-[620px]:grid-cols-12">
        {/* Brand — uses the shared HelprMark component so the wordmark
            here matches the top nav exactly (H emblem + non-italic
            "Helpr" + italic burnt-sienna "· LA" tail). */}
        <div className="col-span-2 min-[620px]:col-span-4 space-y-3">
          <HelprMark to="/" size="md" hideEmblem />
          {/* Break after the first sentence so the tagline wraps predictably
              into two short lines instead of one long one that pushes the
              link columns around. */}
          <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-xs leading-relaxed">
            Hire a Helpr or find local work.
            <br />
            For everyday jobs, big and small.
          </p>
        </div>

        {/* Company */}
        <div className="min-[620px]:col-span-3">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Company
          </h3>
          {/* The footer is the site's full index, so it carries the top nav's
              destinations PLUS the secondary ones the nav has no room for.
              Without Jobs here, a visitor who scrolled past the nav had no path
              back to it, and the page lost an internal link to a key SEO
              destination.

              "How it works" is deliberately NOT here (owner, 2026-08-22). It
              was removed from the top nav earlier for the same reason: it is an
              anchor into the home page (/#how-it-works), not a destination of
              its own, so from any other page it reads as a link that throws you
              back to the marketing home.

              "Membership" is not here either (owner, 2026-08-22): plans are
              something you meet once you have an account — "they will see once
              they sign up" — so advertising the pricing page to a signed-out
              visitor sells an upgrade before they have the thing being
              upgraded. /subscription is still routable and still linked from
              inside the app. */}
          {/* Single column, matching Legal and Follow. Uneven column LENGTHS
              are normal in a footer — three different list treatments side by
              side is what looks unfinished. */}
          <ul className="space-y-2 text-ds-11 text-[hsl(var(--olivewood))]/85">
            <li>
              <Link to="/jobs" className="link-standard">
                Jobs
              </Link>
            </li>
            {BUSINESS_ENABLED && (
            <li>
              <Link to="/for-business" className="link-standard">
                Business
              </Link>
            </li>
            )}
            <li>
              <Link to="/help" className="link-standard">
                Help Center
              </Link>
            </li>
          </ul>
        </div>

        {/* Legal — sm:col-span-2. Its three links (Terms / Rules / Privacy) are
            short enough to fit two columns, and giving the third back to Follow
            pulls that group left, off the far edge.

            The 4/3/2/3 split starts at 560px. It was `md` (768), then `sm`
            (640) — and 640 still missed a 631px window by nine pixels, which is
            exactly the kind of near-miss that makes a fix look like it never
            landed. 560 is where the narrowest column ("Privacy", ~86px) still
            fits, so it is the real floor rather than the next Tailwind step. It used to be 12/4/4/4 through that band, which handed the
            brand block a full row of its own and pushed the three link groups
            onto a second row — so a ~673px window (a docked browser pane) got a
            two-row footer even though all four columns fit side by side there.
            One split from 640px up, instead of a tier that only existed to
            wrap. */}
        <div className="min-[620px]:col-span-2">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
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
        <div className="min-[620px]:col-span-3">
          <h3
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Follow
          </h3>
          {/* Brand-color chips with a softer squircle radius — bigger,
              airier, less pinched than the previous rounded-2xl chips.
              Apple black, Facebook blue, Instagram gradient are kept for
              instant brand recognition. */}
          {/* shrink-0 on each icon below. They are `inline-flex` children of this
              flex row, so they were flex-shrinking below their `w-11`: measured
              24px wide against 44px tall, i.e. rendering as ovals rather than
              the circles `rounded-full` implies. Height was never the problem —
              width was being taken away. */}
          <div className="flex items-center gap-2.5">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5"
              aria-label="Download on the App Store (opens in a new tab)"
              title="Download on the App Store"
            >
              <Apple
                className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110"
                strokeWidth={1.5}
                fill="currentColor"
              />
            </a>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--facebook))] text-white shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5"
              aria-label="Follow us on Facebook (opens in a new tab)"
              title="Follow us on Facebook"
            >
              <Facebook
                className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110"
                strokeWidth={1.5}
                fill="currentColor"
              />
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5"
              style={{
                background:
                  "linear-gradient(135deg, #f9ce34 0%, #ee2a7b 50%, #6228d7 100%)",
              }}
              aria-label="Follow us on Instagram (opens in a new tab)"
              title="Follow us on Instagram"
            >
              <Instagram className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" />
            </a>
          </div>
        </div>
      </div>

      {/* Bottom row: copyright */}
      <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-[hsl(var(--olivewood))]/15">
        {/* "All rights reserved." dropped so this holds ONE line at 375px —
            it wrapped to a stranded "USA" on phones. The phrase is vestigial:
            under the Berne Convention copyright subsists without any notice
            at all, so it carries no legal weight and costs a whole line on
            the narrowest screens. `whitespace-nowrap` keeps it honest if the
            year or wording ever grows. */}
        <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 whitespace-nowrap">
          © {new Date().getFullYear()} Helpr LLC · Louisiana, USA
        </p>
        <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 flex items-center gap-1.5">
          Made with{" "}
          <Heart
            className="w-3 h-3"
            style={{
              color: "hsl(var(--burnt-sienna))",
              fill: "hsl(var(--burnt-sienna))",
            }}
          />{" "}
          for Louisiana communities
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
