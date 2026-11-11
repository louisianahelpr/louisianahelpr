import { Apple, Heart } from "lucide-react";
import { Suspense, useEffect } from "react";
import { Link } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import { useAuthReady } from "@/hooks/useAuthReady";
import { browseDestinationFor } from "@/lib/browseDestination";
import { prefetchRoutesWhenIdle } from "@/lib/routePrefetch";
import { APP_STORE_URL, APP_STORE_LISTING_LIVE } from "@/lib/appStore";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { optionalLazy } from "@/lib/optionalLazy";
import { useGuestSpanish } from "@/components/landing/useGuestSpanish";

// F260q (owner 11-11): the English / Español switch for signed-out visitors, in its own chunk so the landing's first
// paint carries none of the i18n modules (the footer is below the fold).
const LanguageToggle = optionalLazy(() => import("@/components/LanguageToggle").then((m) => ({ default: m.LanguageToggle })), "LanguageToggle");

// Inline Facebook glyph — lucide-react v1.x removed brand icons including
// `Facebook`. Inlining the standard "f" mark keeps the social link working
// without pinning lucide back to 0.x.
const Facebook = ({ className, fill }: { className?: string; fill?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill={fill ?? "currentColor"}
    stroke="currentColor"
    strokeWidth={ICON_STROKE_PX}
    aria-hidden="true"
  >
    <path d="M14 13.5h2.5l1-4H14V7c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z" vectorEffect="non-scaling-stroke" />
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
    strokeWidth={ICON_STROKE_PX}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" vectorEffect="non-scaling-stroke" />
    <circle cx="12" cy="12" r="4" vectorEffect="non-scaling-stroke" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" vectorEffect="non-scaling-stroke" />
  </svg>
);

// Moved to lib/appStore.ts when ForceUpdateGate needed the same URL: on that
// screen it is the ONLY way out of a blocked app, so the two copies must not
// be allowed to drift.
/**
 * Footer links (owner's UI audit 11-09, F006): 13px text with a 44px tall tap area. F006 gave the 44px to touch
 * screens only and L017 (landing audit 11-09) kept 24px for a mouse; F214 (whole-app audit 11-10) measured 24px rows
 * on a phone emulator with a fine pointer while /browse's shell showed 44px, so the 44px now holds on every pointer.
 */
const FOOTER_LINK = "link-standard inline-flex items-center min-h-11";

const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";
// Live since 2026-10-20 (owner: "i created a instagram").
const INSTAGRAM_URL = "https://www.instagram.com/louisianahelpr/";

/**
 * Editorial footer — matches the landing hero's parchment surface, no
 * card panels, quiet Heritage Gold section labels. Store badges live
 * here (relocated from the nav) — Google Play shows a "Coming soon"
 * state until the Android app ships.
 */
/**
 * `landing` (owner-approved landing redesign, 2026-10-20): the footer's column
 * lines up with the landing's 72rem measure and wears its warm tokens. Every
 * other page keeps the full-width footer.
 */
const Footer = ({ landing = false }: { landing?: boolean } = {}) => {
  // The footer renders on public AND authed surfaces (App.tsx, PageHeader,
  // AuthShell, PublicLayout), so its "Jobs" link cannot be a constant.
  const { user } = useAuthReady();
  // F260q (owner 11-11, Spanish everything): the Spanish words when the visitor's language is Spanish (fetched only
  // then); otherwise the English written here, which enPublic.ts mirrors (publicPagesInSpanish.test.tsx).
  const es = useGuestSpanish();
  const w = (key: string, english: string) => es?.[key] ?? english;

  /* WARM THE FOOTER'S OWN DESTINATIONS WHILE THE READER IS STILL READING.
     Legal and the Help Center are lazy chunks, and the footer used to be the
     only nav surface in the app that prefetched nothing — so Terms, Rules and
     Privacy were each fetched cold at the moment of the tap (owner,
     2026-09-11: "terms rules and privact take awhile to load in the footer").

     Idle-scheduled rather than hover-triggered, and that is the point: hover
     does not exist on a phone, which is this app's primary surface, so an
     onMouseEnter prefetch would have fixed the complaint only on desktop. By
     the time anyone has scrolled far enough to SEE the footer, the page they
     are on has long since settled, so the idle callback has had every chance
     to fire. `prefetchRoute`'s `warmed` set keeps this to one fetch per chunk
     for the session, and the returned canceller drops the pending callback if
     the footer unmounts first.

     One key covers /terms, /rules and /privacy: they resolve to the same
     module, so warming /legal leaves the other three free. */
  useEffect(() => prefetchRoutesWhenIdle(["/legal", "/help"]), []);

  // NO footer on any signed-in screen (owner, 2026-10-06, a footer under the
  // signed-in /payment-success page). Decided here, in the one component, so
  // every shell that mounts it (AuthShell, PublicLayout) follows; the hooks
  // above still run in the same order on every render.
  if (user) return null;

  return (
  <footer
    className="px-5 sm:px-8 lg:px-12 relative border-t border-[hsl(var(--olivewood))]/15"
    style={{
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      backdropFilter: "blur(20px) saturate(170%)",
      WebkitBackdropFilter: "blur(20px) saturate(170%)",
      color: "hsl(var(--olivewood))",
    }}
  >
    <div className={`page-measure pt-6 md:pt-8 pb-2${landing ? " max-w-6xl" : ""}`}>
      {/* Columns go side-by-side from sm (640px), not md (768px). At tablet
          widths the old md-only grid stacked brand + Company + Legal + Follow
          into ONE tall column, which made the footer dominate the page. From
          640px the brand takes the full row and the three link groups sit
          4/4/4 beside each other; md+ keeps the original 4/3/3/2 layout. */}
      {/* Base grid-cols-2 so the three link groups pair up below sm rather
          than stacking one-per-row. At ~400-640px that was four full-width
          blocks of vertical scroll for content that fits in two columns.
          The brand block spans both so its tagline keeps one measure. */}
      <div className="grid grid-cols-2 min-[360px]:grid-cols-[auto_auto_auto] min-[360px]:justify-between min-[500px]:grid-cols-3 min-[500px]:justify-normal gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12">
        {/* Brand — uses the shared HelprMark component so the mark
            here matches the top nav exactly (H emblem + non-italic
            "Helpr" + italic burnt-sienna "· LA" tail). */}
        <div className="col-span-2 min-[360px]:col-span-3 min-[620px]:col-span-4 space-y-3">
          {/* The H logo, never the "Helpr" wordmark (owner, 2026-10-20 08:30Z). */}
          <HelprMark to="/" size="md" emblemOnly />
          {/* Break after the first sentence so the tagline wraps predictably
              into two short lines instead of one long one that pushes the
              link columns around. */}
          <p className="text-ds-13 text-[hsl(var(--olivewood))]/80 max-w-xs leading-relaxed">
            {/* L036 (landing audit 11-09): only the sections open today (Shops and Homes are Coming soon). */}
            {w("footer.taglineLead", "Jobs and Declutter")}
            <br />
            {w("footer.taglineTail", "for Louisiana.")}
          </p>
        </div>

        {/* Company */}
        {/* col-span-2 + order-1 below 500 ONLY: Company takes the full row to
            itself there (its "Help Center" link is the longest label in the
            footer), which frees Follow to sit beside Legal on the row below
            instead of stranded alone with 3 icons in a whole empty row (owner:
            "follow can fit on the left of legal"). order-none from 500 up
            restores the natural DOM order the 3-col/4-col layouts already rely
            on. */}
        <div className="col-span-2 order-1 min-[360px]:col-span-1 min-[360px]:order-none min-[620px]:col-span-3">
          <h2
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {w("footer.explore", "Explore")}
          </h2>
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
              upgraded. Membership lives inside the app at
              /profile?tab=subscription (the standalone /subscription route
              was removed in 49f4f2f30). */}
          {/* Single column, matching Legal and Follow. Uneven column LENGTHS
              are normal in a footer — three different list treatments side by
              side is what looks unfinished. */}
          <ul className="space-y-2 [@media(pointer:coarse)]:space-y-0 text-ds-13 text-[hsl(var(--olivewood))]/85">
            <li>
              {/* Named, not bounced: a signed-in reader goes straight to the
                  authed feed and a visitor to the guest one. Same label either
                  way — one feature, one noun (see browseDestinationFor). */}
              <Link to={browseDestinationFor(user)} className={FOOTER_LINK}>
                {w("footer.jobs", "Jobs")}
              </Link>
            </li>
            <li>
              {/* Owner 11-04: Declutter's Browse, which guests and members both read. */}
              <Link to="/declutter" className={FOOTER_LINK}>
                Declutter
              </Link>
            </li>
            <li>
              {/* L035 (landing audit 11-09): the Helpr directory (open to guests, F071) had no link from the landing or
                  the footer. */}
              <Link to="/helprs" className={FOOTER_LINK}>
                {w("footer.findHelpr", "Find a Helpr")}
              </Link>
            </li>
            <li>
              <Link to="/help" className={FOOTER_LINK}>
                {w("footer.help", "Help center")}
              </Link>
            </li>
            {/* F255 (audit 11-10, owner 2026-11-11): what it costs and how members are kept safe. */}
            <li>
              <Link to="/fees" className={FOOTER_LINK}>
                {w("footer.fees", "Fees")}
              </Link>
            </li>
            <li>
              <Link to="/safety" className={FOOTER_LINK}>
                {w("footer.safety", "Safety")}
              </Link>
            </li>
            <li>
              {/* /contact redirects here too (vercel.json); this is where a
                  person who wants to reach us lands. */}
              <Link to="/support" className={FOOTER_LINK}>
                {w("footer.contact", "Contact us")}
              </Link>
            </li>
          </ul>
        </div>

        {/* Legal — sm:col-span-2. Its three links (Terms / Rules / Privacy) are
            short enough to fit two columns, and giving the third back to Follow
            pulls that group left, off the far edge.

            500-619: the three LINK groups share one row (grid-cols-3, brand
            spanning all three). Below 500 it drops back to two, because the
            Follow column holds three 44px icons — a 152px floor that a third of
            a 375px row cannot hold, and forcing it there overflowed the page by
            31px. It used to be grid-cols-2, which handed Company
            and Legal half the row each for two and three short words — and
            pushed Follow onto a third row of its own for the sake of three
            icons. Three narrow columns beat two fat ones and a widow.

            The 4/3/2/3 split starts at 620px. It was `md` (768), then `sm`
            (640) — and 640 still missed a 631px window by nine pixels, which is
            exactly the kind of near-miss that makes a fix look like it never
            landed. 560 is where the narrowest column ("Privacy", ~86px) still
            fits, so it is the real floor rather than the next Tailwind step. It used to be 12/4/4/4 through that band, which handed the
            brand block a full row of its own and pushed the three link groups
            onto a second row — so a ~673px window (a docked browser pane) got a
            two-row footer even though all four columns fit side by side there.
            One split from 640px up, instead of a tier that only existed to
            wrap. */}
        <div className="order-3 min-[360px]:order-none min-[620px]:col-span-2">
          <h2
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {w("footer.legal", "Legal")}
          </h2>
          <ul className="space-y-2 [@media(pointer:coarse)]:space-y-0 text-ds-13 text-[hsl(var(--olivewood))]/85">
            <li>
              <Link to="/terms" className={FOOTER_LINK}>
                {w("footer.terms", "Terms")}
              </Link>
            </li>
            <li>
              <Link to="/rules" className={FOOTER_LINK}>
                {w("footer.rules", "Rules")}
              </Link>
            </li>
            <li>
              <Link to="/privacy" className={FOOTER_LINK}>
                {w("footer.privacy", "Privacy")}
              </Link>
            </li>
          </ul>
        </div>

        {/* Follow — App Store icon (download) + Facebook + Instagram (socials).
            Compact squircle chips, one row. */}
        <div className="order-2 min-[360px]:order-none min-[620px]:col-span-3">
          <h2
            className="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {w("footer.follow", "Follow")}
          </h2>
          {/* One olive monochrome chip for every network (owner's UI audit
              11-09, F005: Facebook blue and the Instagram gradient were off
              brand), the same chip the App Store link wears. */}
          {/* shrink-0 on each icon below. They are `inline-flex` children of this
              flex row, so they were flex-shrinking below their `w-11`: measured
              24px wide against 44px tall, i.e. rendering as ovals rather than
              the circles `rounded-full` implies. Height was never the problem —
              width was being taken away. */}
          <div className="flex items-center gap-2.5">
            {/* The App Store chip is HIDDEN until the listing is live (owner,
                2026-10-04, Q1124: it 404s); it returns as a real link with the
                real ID from the launch checklist (Q1289). Facebook and Instagram
                are both real, clickable accounts. */}
            {APP_STORE_LISTING_LIVE && (
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110"
                aria-label={w("footer.appStore", "Download Helpr on the App Store (opens in a new tab)")}
                title={w("footer.appStoreTitle", "Download on the App Store")}
              >
                <Apple className="h-[18px] w-[18px]" fill="currentColor" />
              </a>
            )}
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110"
              aria-label={w("footer.facebook", "Follow us on Facebook (opens in a new tab)")}
              title={w("footer.facebookTitle", "Follow us on Facebook")}
            >
              <Facebook
                className="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110"
                fill="currentColor"
              />
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110"
              aria-label={w("footer.instagram", "Follow us on Instagram (opens in a new tab)")}
              title={w("footer.instagramTitle", "Follow us on Instagram")}
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
          © {new Date().getFullYear()} Louisiana Helpr · Helpr LLC
        </p>
        {/* F260q (owner 11-11): signed-out visitors pick English or Español here (Log in and Sign up carry it too). */}
        <Suspense fallback={null}>
          <LanguageToggle />
        </Suspense>
        <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 flex items-center gap-1.5">
          {w("footer.madeWith", "Made with")}{" "}
          {/* L018 (landing audit 11-09): the icon was aria-hidden, so it read "Made with for Louisiana communities". */}
          <Heart
            className="w-3 h-3"
            role="img"
            aria-hidden={false}
            aria-label={w("footer.love", "love")}
            style={{
              // Olive, not rust: rust is for money only (audit #14).
              color: "hsl(var(--bark))",
              fill: "hsl(var(--bark))",
            }}
          />{" "}
          {w("footer.forCommunities", "for Louisiana communities")}
        </p>
      </div>
    </div>
  </footer>
  );
};

export default Footer;
