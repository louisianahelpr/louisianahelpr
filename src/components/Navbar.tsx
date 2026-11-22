import { Link, useLocation } from "react-router-dom";
import { Briefcase, Gift, Sofa } from "lucide-react";
import { Button } from "@/components/ui/button";
import { forwardRef, useEffect, useState } from "react";
import { prefetchRoute } from "@/lib/routePrefetch";
import HelprMark from "@/components/HelprMark";
import { wordInLang as navWord } from "@/lib/i18n/inLang";
import { cn } from "@/lib/utils";
import { PUBLIC_CONTAINER } from "@/lib/publicContainer";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { wordInLang } from "@/lib/i18n/inLang";

interface NavbarProps {
  /**
   * Force the bordered/opaque "scrolled" chrome from the top of the page,
   * independent of scroll position. Interior pages (anything with a nav
   * spacer) opt in so the Heritage Gold hairline always marks where the
   * nav ends — otherwise the transparent nav has no visible bottom edge
   * against the page surface. The landing hero leaves this off so the nav
   * floats over the photo until the user scrolls.
   */
  solid?: boolean;
  /**
   * The landing page. Since F017 (owner UI audit 11-09) every public page's bar is centred at the landing's 78rem
   * measure, so the bar no longer differs; the prop stays for PublicLayout's call and as the landing marker.
   * Its contents are the same bar as every other public page (owner, 2026-10-21: "Jobs | Log in · Join free").
   */
  landing?: boolean;
}

/**
 * Owner 11-21: "no need to show home in the top nav bar when jobs, declutter and holiday gift guides are selected
 * because they have a back button to the left of the title". The sections' own pages and sub-pages: the public job
 * board (/browse, and /jobs/...), Declutter (/declutter/...) and the gift guides (/gift-guides/...). The H logo still
 * links home everywhere. Guard: src/test/declutterGuestHomeLinks1120.test.tsx.
 */
const NAV_HOME_HIDDEN_ON = ["/browse", "/jobs", "/declutter", "/gift-guides"] as const;
const navHomeHiddenOn = (path: string) => NAV_HOME_HIDDEN_ON.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Audit 11-21 (P19): on /browse "Jobs" had aria-current but looked like every other link, and on /jobs/<id> no link was
 * current at all. The section a path belongs to (a job page is Jobs, an item page is Declutter), and the visible mark
 * the current link wears: the brand olive and an underline (colour is never the only signal).
 */
function navSection(path: string): "jobs" | "declutter" | "guides" | null {
  const under = (p: string) => path === p || path.startsWith(p + "/");
  if (under("/browse") || under("/jobs")) return "jobs";
  if (under("/declutter")) return "declutter";
  if (under("/gift-guides")) return "guides";
  return null;
}
const NAV_CURRENT_MARK = "aria-[current=page]:text-[hsl(var(--bark))] aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[6px]";

const Navbar = forwardRef<HTMLElement, NavbarProps>(({ solid = false, landing = false }, ref) => {
  // F017: the landing no longer changes the bar's container (one on every public page, PUBLIC_CONTAINER). D021 (landing
  // design audit 11-10): on a phone the landing's bar keeps only the logo, Log in and Join free; its hero already has
  // the Jobs | Declutter switch, so the Jobs and Declutter links (and their divider) were a full bar of repeats there.
  const phoneHidden = landing ? " max-[639px]:hidden" : "";
  // Owner 11-19 ("make sure the guides can be easily viewed and accessed when signed in or out"): the short "Guides"
  // link shows at every phone width on EVERY public page, not only the landing. The other pages' phone bar also carries
  // Jobs and Declutter, so there (never on the landing, whose bar is unchanged and matches index.html's shell) the bar
  // makes room: below 480 Jobs and Declutter are their section icons (named by sr-only words), the links' padding and
  // gaps tighten, the divider waits for sm, and below 400 the bar's side gutter is 12px; below 375 "Guides" drops its
  // gift icon. Measured in headless Chrome with the app's Montserrat at 320-767 (English fits at every width; the
  // tightest is 320 with 4px to spare). Guard: src/test/navGiftGuidesOnPhone1118.test.tsx.
  const tight = !landing;
  // Session-only auth (no profile DB round-trip) so the marketing nav can
  // reflect logged-in state: an authenticated visitor landing on a public
  // page (/legal, /) sees none of the signed-out "Jobs | Log in · Join free"
  // actions (see below).
  const { user } = useAuthReady();
  // On the wide desktop *website*, a signed-in visitor already has the
  // persistent RIGHT rail (DesktopSidebarNav) on app/marketing routes the rail
  // covers (e.g. /jobs, /browse). Showing this top marketing nav too would
  // stack two navs with a redundant "Open app" CTA — so step aside and let the
  // rail be the sole chrome. Guests keep the marketing nav (the rail's
  // destinations are all auth-gated), and the rail itself stays hidden on
  // native + narrow viewports, so this only suppresses the genuine overlap.
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const railOwnsNav = isWebDesktop && !!user && isDesktopRailRoute(location.pathname);
  // This nav is `position: fixed; top: 0`, so the global OfflineBanner (also
  // fixed at top:0) would overlay it. The `#root` padding that reserves space
  // for the banner on document-scroll pages can't move a fixed element, so
  // shift the nav's own top down by the banner's reserved height. 0 normally.
  const bannerOffset = useOfflineBannerOffset();
  // Owner decision 11-18 (hero mockup B, "Color band"): on the landing the hero's olive-to-cream band runs up behind
  // the bar, so at the very top the bar is see-through (landing-nav-top); from the first scroll it is the opaque white
  // bar again (P5-7, landingHeaderOpaque.test.ts). Starts true, so the HTML-drawn shell (index.html) matches.
  const [atTop, setAtTop] = useState(true);
  // Holiday audit 1121 #78: on every public page, once scrolled, the bar is opaque (nav-past-top): its 72% glass let
  // the page's text show through and run into the nav's own words at 375 ("Gift idea..." behind "Guides Log in").
  useEffect(() => {
    const read = () => setAtTop(window.scrollY <= 0);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  if (railOwnsNav) return null;

  return (
    <nav
      ref={ref}
      aria-label="Primary"
      className={cn(
        "fixed top-0 left-0 right-0 z-50 glass-nav",
        solid && "is-scrolled",
        landing && atTop && "landing-nav-top",
        !landing && !atTop && "nav-past-top",
      )}
      style={{
        // Subtle always-on backdrop blur so the nav reads as a floating
        // glass strip at every scroll position without triggering a
        // state change. Layers over the nav's existing bg (transparent
        // on landing, opaque on interior via is-scrolled).
        // Blur only — NO saturate(). `saturate()` on a backdrop filter
        // amplifies the colour of whatever passes beneath the bar, so the
        // olive "Join free" button and the dark emblem bled a green cast up
        // into the strip, and it shifted as the page scrolled under it. That is
        // the "green jumping shadow" and the "jumping colours": not a shadow at
        // all, but the nav re-saturating live content behind itself.
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        // The iOS Capacitor WebView is edge-to-edge (`overlaysWebView: true`
        // in capacitor.config.ts + setOverlaysWebView({overlay:true}) in
        // nativeInit.ts), so the status bar overlaps the WebView on every
        // platform. Pad by the safe-area top inset (clamped to 0.25rem so the
        // logo isn't flush on browsers that report a zero inset).
        paddingTop: "max(var(--safe-area-top, 0px), 0.25rem)",
        top: bannerOffset ? `${bannerOffset}px` : undefined,
      }}
    >
      <div
        className={cn(
          `w-full flex items-center justify-between h-[var(--public-nav-h)]
          pl-[max(1.25rem,var(--safe-area-left,0px))] pr-[max(1.25rem,var(--safe-area-right,0px))]
          sm:pl-[max(2rem,var(--safe-area-left,0px))] sm:pr-[max(2rem,var(--safe-area-right,0px))]
          lg:pl-[max(3rem,var(--safe-area-left,0px))] lg:pr-[max(3rem,var(--safe-area-right,0px))]`,
          // F017 (owner UI audit 11-09): every public page's bar sits in the landing's 78rem container (it used to be
          // the landing's alone, so the logo and links jumped between / and /browse). PublicHeaderPage holds its
          // title and body to the same container (PUBLIC_CONTAINER).
          PUBLIC_CONTAINER,
          tight && "max-[399px]:pl-[max(0.75rem,var(--safe-area-left,0px))] max-[399px]:pr-[max(0.75rem,var(--safe-area-right,0px))]",
        )}
      >
        {/* Emblem + wordmark on the MARKETING nav. This is the public,
            first-impression surface, and the wrought-iron H is the most
            distinctive part of the brand — it previously appeared only on
            the auth screens. The authed DashboardHeader deliberately stays
            wordmark-only (hideEmblem): in-app the user already knows where
            they are, and the top bar is tight on vertical space. */}
        {/* emblemOnly (owner): the crest alone, no "Helpr · LA" wordmark. The
            emblem keeps alt="Helpr", so the link's accessible name is unchanged
            — dropping the words must not drop the name. */}
        {/* The H logo on every bar, the landing's included (owner, 2026-10-20 08:30Z:
            never the "Helpr" wordmark). */}
        <HelprMark to="/" size="md" emblemOnly className="shrink-0" />
        {/* Smooth-scroll-to-top behavior on the marketing root used to
            live inline on this Link; HelprMark handles routing but if
            we want the same behavior in the future, replace with a
            local onClick wrapper. */}

        {/* ONE bar on every public page, the landing included (owner, 2026-10-21):
            signed out it reads "Jobs · Declutter | Log in · Join free" at every width.
            "Jobs" is the public board (/browse), "Declutter" its guest Browse (owner
            11-04) and "Join free" is sign-up (/signup) on every page; "Get started"
            and "How it works" are gone. There is no hamburger (owner): the three
            things that matter fit the bar on a phone.
            A signed-in visitor gets NOTHING here (owner, 2026-08-30: "delete
            globally"): the app's own navigation (the desktop rail, the bottom
            nav on a phone) already carries them. */}
        {!user && (
          <div className={tight ? "flex items-center gap-0 min-[480px]:gap-1 sm:gap-3" : "flex items-center gap-0 min-[375px]:gap-0.5 min-[400px]:gap-1 sm:gap-3"}>
            {/* Owner 11-20 (site polish A1): a "Home" link off the landing, from md up (the phone bar is full at 320;
                there the logo goes home). Owner 11-21: not on the Jobs, Declutter or Holiday Gift Guides pages either,
                whose own back arrow, left of the title, already goes home (NAV_HOME_HIDDEN_ON; route-based). */}
            {location.pathname !== "/" && !navHomeHiddenOn(location.pathname) && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden md:inline-flex rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"
              >
                <Link to="/" data-testid="nav-home">{navWord("nav.home", "Home")}</Link>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={tight ? `rounded-full px-1.5 max-[374px]:text-ds-13 min-[375px]:px-2 sm:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))] ${NAV_CURRENT_MARK}` : `rounded-full px-1 max-[374px]:text-ds-13 min-[375px]:px-2 min-[400px]:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))] ${NAV_CURRENT_MARK}${phoneHidden}`}
            >
              <Link
                to="/browse"
                aria-current={navSection(location.pathname) === "jobs" ? "page" : undefined}
                onMouseEnter={() => prefetchRoute("/browse")}
                onFocus={() => prefetchRoute("/browse")}
              >
                {/* Design audit areas 11-18 #1: Spanish for a Spanish reader (the footer's own word). */}
                {tight ? (
                  <>
                    <Briefcase aria-hidden className="min-[480px]:hidden" />
                    <span className="max-[479px]:sr-only">{navWord("footer.jobs", "Jobs")}</span>
                  </>
                ) : navWord("footer.jobs", "Jobs")}
              </Link>
            </Button>
            {/* Owner 11-04: Declutter next to Jobs. A guest reads its Browse too (BUY-16). */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={tight ? `rounded-full px-1.5 max-[374px]:text-ds-13 min-[375px]:px-2 sm:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))] ${NAV_CURRENT_MARK}` : `rounded-full px-1 max-[374px]:text-ds-13 min-[375px]:px-2 min-[400px]:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))] ${NAV_CURRENT_MARK}${phoneHidden}`}
            >
              <Link
                to="/declutter"
                aria-current={navSection(location.pathname) === "declutter" ? "page" : undefined}
              >
                {tight ? (
                  <>
                    <Sofa aria-hidden className="min-[480px]:hidden" />
                    <span className="max-[479px]:sr-only">Declutter</span>
                  </>
                ) : "Declutter"}
              </Link>
            </Button>
            {/* Owner 2026-11-18: "Holiday Gift Guides" in the public top bar, in full from md up; below md the short
                "Guides" link under it takes its place. */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={`hidden md:inline-flex rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))] ${NAV_CURRENT_MARK}`}
            >
              <Link
                to="/gift-guides"
                aria-current={navSection(location.pathname) === "guides" ? "page" : undefined}
                data-testid="nav-gift-guides"
              >
                Holiday Gift Guides
              </Link>
            </Button>
            {/* Owner 2026-11-18, on the phone landing: "Where am I suppose to find the holiday guides here? Shouldn't it be
                on the top nav?" (this overrides 11-04's phone bar of only Jobs, Declutter, Log in and Join free). Below md
                the bar has a short "Guides" link with the gift icon, named "Holiday Gift Guides" in full (sr-only prefix). Owner 11-19: it shows
                at every phone width on every public page (see `tight` above for how the other pages' bar makes room).
                Guard: src/test/navGiftGuidesOnPhone1118.test.tsx. */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={`${tight ? "md:hidden gap-1 rounded-full px-2 max-[374px]:px-1 max-[374px]:text-ds-13 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]" : "md:hidden gap-1 rounded-full px-2 max-[374px]:text-ds-13 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"} ${NAV_CURRENT_MARK}`}
            >
              <Link
                to="/gift-guides"
                aria-current={navSection(location.pathname) === "guides" ? "page" : undefined}
                data-testid="nav-gift-guides-phone"
              >
                <Gift aria-hidden className={tight ? "max-[374px]:hidden" : undefined} />
                {/* Its name is "Holiday Gift Guides", which holds the visible word (WCAG 2.5.3, labelInName.test.tsx). */}
                <span className="sr-only">Holiday Gift Guides</span>
                <span aria-hidden>Guides</span>
              </Link>
            </Button>
            {/* The divider between the public links and the auth actions. Below 400px the bar drops it and
                tightens the link padding (below 375 also one text size down), so Jobs + Declutter fit beside the logo without squeezing it
                (owner 11-04; measured at 320, 360 and 375). */}
            <span aria-hidden className={tight ? "hidden sm:block w-px h-5 mx-1" : `hidden min-[400px]:block w-px h-5 mx-1${phoneHidden}`} style={{ background: "hsl(var(--olivewood) / 0.18)" }} />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={tight ? "rounded-full px-1 max-[374px]:text-ds-13 min-[375px]:px-2 sm:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]" : "rounded-full px-1 max-[374px]:text-ds-13 min-[375px]:px-2 min-[400px]:px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"}
            >
              <Link
                to="/login"
                onMouseEnter={() => prefetchRoute("/login")}
                onFocus={() => prefetchRoute("/login")}
              >
                {wordInLang("g.logIn", "Log in")}
              </Link>
            </Button>
            {/* "Join free" — explicit light-cream text. The `default` variant
                nominally resolves text-primary-foreground → --parchment, but that
                two-hop token chain has repeatedly rendered dark-on-olive in the
                WebView. Pin the color locally — `!text-...` on the button itself
                plus a belt-and-braces inline style — so it can never lose the
                cascade, independent of variant token resolution. */}
            <Button
              asChild
              size="sm"
              className="rounded-full px-3 max-[374px]:text-ds-13 min-[375px]:px-4 sm:px-5 btn-press !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
              style={{ color: "hsl(var(--parchment))" }}
            >
              <Link
                to="/signup"
                onMouseEnter={() => prefetchRoute("/signup")}
                onFocus={() => prefetchRoute("/signup")}
              >
                {wordInLang("g.joinFree", "Join free")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
});
Navbar.displayName = "Navbar";

export default Navbar;
