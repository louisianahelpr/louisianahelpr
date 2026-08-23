import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * NotFound — deliberately does NOT wrap in PublicLayout. A 404 is a
 * dead-end state; the goal is to route the user back to somewhere real
 * with the two big CTAs below, not to hand them another set of nav links
 * to click deeper into invalid space. The audit surfaced this as a
 * "bespoke chrome" outlier — the choice is intentional. If a future
 * change re-adds the marketing nav here, verify it doesn't turn a
 * recovery moment into a wander-off.
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

  return (
    <div className="min-h-screen page-warmth relative">
      <div aria-hidden className="mesh-gradient-global" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-5">
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
    </div>
  );
};

export default NotFound;
