import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { usePageMeta } from "@/hooks/usePageMeta";
import PublicLayout from "@/components/marketing/PublicLayout";
import { setNotFoundPathname } from "@/hooks/useAppShellViewport";

/**
 * NotFound — the catch-all `path="*"` route.
 *
 * It now wraps in PublicLayout, so it carries the same marketing Navbar +
 * Footer as /jobs, /help and /legal (owner, 2026-08-24, audit V12). This
 * REVERSES an earlier note here which argued a 404 should stay chrome-less
 * so the two big CTAs were the only way out and the visitor couldn't
 * "wander off into invalid space". The reasoning didn't survive contact with
 * how people actually arrive: a 404 is reached by a stale bookmark, a bad
 * external link, or a typo — the visitor's next move is usually "find the
 * real page", and the two CTAs on offer (back, home) cannot serve that.
 * Search, Jobs, Help and the footer's site map can. It was also the ONE
 * public route with bespoke chrome, so a wrong URL made the site look like
 * it had changed identity at the worst possible moment for trust.
 *
 * The branded 404 hero, Go Back and Back to Home are unchanged.
 *
 * On NATIVE, PublicLayout renders AppShell instead of the marketing chrome
 * (no App Store footer inside the app), so the in-app 404 is unaffected.
 */
const NotFound = () => {
  // The SPA serves unknown paths with a 200 status, so the 404 page must
  // be explicitly non-indexable to keep junk URLs out of search results.
  usePageMeta({
    title: "Page Not Found — Helpr",
    description: "The page you're looking for doesn't exist or has been moved.",
    robots: "noindex",
  });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    report(new Error(`404 — non-existent route: ${location.pathname}`), {
      severity: "info",
      tags: { source: "NotFound", route: location.pathname },
    });
  }, [location.pathname]);

  // Tell useAppShellViewport that THIS pathname is the catch-all, so it drops
  // the `html.app-shell` 100dvh/overflow:hidden lock. Without it the nav +
  // footer this page now carries are taller than a viewport and everything
  // past the fold — including "Back to Home" on a phone — is unreachable.
  // The route table can't express "every path that isn't a route", so the
  // page reports itself; see setNotFoundPathname.
  useEffect(() => {
    setNotFoundPathname(location.pathname);
    return () => setNotFoundPathname(null);
  }, [location.pathname]);

  return (
    // page-warmth + mesh-gradient-global are NOT repeated here: PublicLayout
    // already paints both, and stacking a second mesh over the first doubled
    // the gradient's opacity.
    <PublicLayout>
      <div className="flex items-center justify-center px-5 py-16 sm:py-24 lg:py-28">
        <div className="text-center space-y-7 max-w-md">
          <Link to="/" className="inline-flex items-baseline gap-1">
            <span
              className="font-display italic font-bold leading-none text-ds-32"
              style={{
                color: "hsl(var(--olivewood))",
                letterSpacing: "-0.02em",
              }}
            >
              Helpr
            </span>
            <span
              className="font-display italic font-bold leading-none text-ds-20"
              style={{
                color: "hsl(var(--burnt-sienna))",
                letterSpacing: "0.22em",
                marginLeft: "0.12em",
              }}
            >
              · LA
            </span>
          </Link>

          <div className="space-y-3">
            <span className="text-display-eyebrow">Page not found</span>
            <h1
              className="font-display italic font-bold leading-none"
              style={{
                fontSize: "clamp(4rem, 10vw + 1rem, 7rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.045em",
              }}
            >
              404
            </h1>
            <p className="font-serif italic text-ds-17" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              This page doesn't exist or has been moved.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="outline"
              className="rounded-ds-md"
              // A bare history.back() is a no-op on a cold deep-link / direct
              // landing where this 404 is the first history entry — fall back
              // to home so the button always does something.
              onClick={() => (window.history.length <= 1 ? navigate("/") : window.history.back())}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
            <Button
              asChild
              variant="primary"
              className="rounded-ds-md"
            >
              <Link to="/">
                <Home className="h-4 w-4 mr-2" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export default NotFound;
