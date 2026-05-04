import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";
import { report } from "@/lib/errorLogger";

const NotFound = () => {
  const location = useLocation();

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
              className="font-display italic font-bold leading-none"
              style={{
                fontSize: "2rem",
                color: "hsl(var(--olivewood))",
                letterSpacing: "-0.02em",
              }}
            >
              Helpr
            </span>
            <span
              className="font-display italic font-bold leading-none"
              style={{
                fontSize: "1.25rem",
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
            <p className="font-serif italic text-lg" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
              This page doesn't exist or has been moved.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go back
            </Button>
            <Button
              asChild
              className="rounded-xl"
              style={{
                background: "hsl(var(--bark))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
              }}
            >
              <Link to="/">
                <Home className="h-4 w-4 mr-2" />
                Back to home
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
