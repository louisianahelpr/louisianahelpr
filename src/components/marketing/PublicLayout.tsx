import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AppShell from "@/components/AppShell";
import { authPages } from "@/components/mobileNav/mobileNavHelpers";
import { isNativePlatform } from "@/lib/nativeInit";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * PublicLayout — shared chrome for the public marketing / SEO surface
 * (landing, /jobs, /for-business, /help,
 * /discharge, /insurance-claim).
 *
 * Gives every marketing page ONE consistent nav (the shared <Navbar>) and
 * ONE footer (<Footer>). The page's own content renders as {children}
 * between the nav spacer and the footer — these pages stay document-scroll
 * (`min-h-screen` / `bg-premium-page`), never AppShell.
 *
 * The shared "ready to start?" CTA band is OFF by default — it read as
 * repetitive stacked above the footer on every page. A page opts IN
 * (showCtaBand) only when it wants that band as its sole conversion CTA.
 */
interface PublicLayoutProps {
  children: ReactNode;
  /** Render the shared CTA band above the footer. Default false. */
  showCtaBand?: boolean;
  /** Headline for the CTA band. */
  ctaHeadline?: string;
  /** Supporting line under the headline. */
  ctaSubcopy?: string;
  /** Primary CTA label (logged-out). */
  ctaLabel?: string;
  /** Primary CTA destination (logged-out). */
  ctaTo?: string;
  /**
   * Drop the spacer that clears the fixed Navbar. The landing hero is
   * designed to flow UNDER the transparent nav, so it opts out; every
   * other page keeps the spacer so content starts below the nav.
   */
  noNavSpacer?: boolean;
}

const PublicLayout = ({
  children,
  showCtaBand = false,
  ctaHeadline = "Ready to start?",
  ctaSubcopy = "Join your Louisiana neighbors getting things done on Helpr.",
  ctaLabel = "Get started",
  ctaTo = "/signup",
  noNavSpacer = false,
}: PublicLayoutProps) => {
  // Session-only auth (no profile round-trip) so the CTA band mirrors the
  // Navbar: an authenticated visitor sees "Open app" instead of the
  // logged-out "Get started".
  const { user } = useAuthReady();
  const location = useLocation();

  // NATIVE (iOS/Android WebView): the marketing Navbar + Footer are web-only
  // chrome — an "App Store download" footer inside the app is nonsensical and
  // reads as a different product. On native, render the page content in the
  // canonical in-app shell (AppShell + a status-bar cap for the notch inset),
  // dropping the marketing nav, footer, CTA band, and web nav spacer. The
  // global MobileNav supplies bottom navigation on authed routes, so reserve
  // that space only when the current route carries the bottom bar. Centralised
  // here so no PublicLayout page can regress the footer onto the app surface.
  if (isNativePlatform) {
    const reserveBottomNav = authPages.some((p) => location.pathname.startsWith(p));
    const statusBarCap = (
      <div
        aria-hidden
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "hsl(var(--surface-band))",
        }}
      />
    );
    return (
      <AppShell
        header={statusBarCap}
        reserveBottomNav={reserveBottomNav}
        className="bg-premium-page"
        contentClassName="bg-premium-page"
      >
        {children}
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen page-warmth pb-safe-nav relative flex flex-col">
      {/* Global mesh behind every section — matches the landing surface. */}
      <div aria-hidden className="mesh-gradient-global" />

      {/* Interior pages (with a nav spacer) keep the Heritage Gold hairline
          from the top so the nav has a visible bottom edge against the page
          surface. The landing hero (noNavSpacer) stays transparent until
          scroll so it can float over the photo. */}
      <Navbar solid={!noNavSpacer} />
      {/* Spacer clears the fixed Navbar (h-12 = 3rem + safe-area top inset)
          AND adds a comfortable breathing gap below it so a page's title/header
          doesn't crowd the nav. The min breathing room is 1.5rem (was 0.25rem,
          which read as touching); a notched device's larger safe-area inset
          wins via max(). The landing hero opts out (noNavSpacer) so it flows
          under the nav. */}
      {!noNavSpacer && (
        <div
          aria-hidden
          style={{ height: "calc(max(env(safe-area-inset-top), 1.5rem) + 3rem)" }}
        />
      )}

      <div className="flex-1">{children}</div>

      {showCtaBand && (
        <section
          aria-label="Get started with Helpr"
          className="relative px-5 sm:px-8 lg:px-12 pt-4 pb-10"
        >
          <div
            className="mx-auto max-w-5xl rounded-ds-lg px-6 py-9 lg:px-10 lg:py-11 text-center"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--bark) / 0.08) 0%, hsl(var(--burnt-sienna) / 0.07) 100%)",
              border: "1px solid hsl(var(--bark) / 0.14)",
            }}
          >
            <h2
              className="font-display italic font-bold text-ds-24 lg:text-ds-32 tracking-[-0.025em] text-balance"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {ctaHeadline}
            </h2>
            <p
              className="font-serif italic text-ds-15 leading-relaxed mt-2 max-w-lg mx-auto"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {ctaSubcopy}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
              {user ? (
                <Button
                  asChild
                  variant="bark"
                  size="lg"
                  className="group rounded-ds-md px-8 w-full sm:w-auto"
                >
                  <Link to="/dashboard">
                    Open app
                    <ArrowRight className="ml-1.5 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    asChild
                    variant="bark"
                    size="lg"
                    className="group rounded-ds-md px-8 w-full sm:w-auto"
                  >
                    <Link to={ctaTo}>
                      {ctaLabel}
                      <ArrowRight className="ml-1.5 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-ds-md px-8 w-full sm:w-auto"
                    style={{
                      borderColor: "hsl(var(--olivewood) / 0.3)",
                      color: "hsl(var(--ink-deep))",
                    }}
                  >
                    <Link to="/#how-it-works">How it works</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
};

export default PublicLayout;
