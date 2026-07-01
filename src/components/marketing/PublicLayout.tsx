import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * PublicLayout — shared chrome for the public marketing / SEO surface
 * (landing, /jobs, /for-business, /enterprise, /become-a-partner,
 * /how-it-works, /help, /discharge, /parishes, /parish/:slug,
 * /insurance-claim).
 *
 * Gives every marketing page ONE consistent nav (the shared <Navbar>),
 * ONE footer (<Footer>), and a consistent "ready to start?" CTA band above
 * the footer. The page's own content renders as {children} between the nav
 * spacer and the CTA band — these pages stay document-scroll
 * (`min-h-screen` / `bg-premium-page`), never AppShell.
 *
 * Pages opt out of the CTA band (showCtaBand={false}) when they already end
 * in their own bespoke conversion CTA, so there's never a stacked pair.
 */
interface PublicLayoutProps {
  children: ReactNode;
  /** Render the shared CTA band above the footer. Default true. */
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
  showCtaBand = true,
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

  return (
    <div className="min-h-screen page-warmth pb-safe-nav relative flex flex-col">
      {/* Global mesh behind every section — matches the landing surface. */}
      <div aria-hidden className="mesh-gradient-global" />

      <Navbar />
      {/* Spacer clears the fixed Navbar (h-12 + safe-area top inset). The
          landing hero opts out (noNavSpacer) so it flows under the nav. */}
      {!noNavSpacer && (
        <div
          aria-hidden
          style={{ height: "calc(max(env(safe-area-inset-top), 0.25rem) + 3rem)" }}
        />
      )}

      <main className="flex-1">{children}</main>

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
                    <Link to="/how-it-works">How it works</Link>
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
