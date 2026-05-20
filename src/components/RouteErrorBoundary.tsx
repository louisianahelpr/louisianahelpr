import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";

/**
 * Per-route error boundary. Sits inside `<Routes>` so a crash on one page
 * shows a brand-aligned fallback in place of that page's content — the
 * header, mobile nav, and other shell chrome stay mounted — and navigating
 * elsewhere clears it. Layered on top of the root `<ErrorBoundary>` in
 * `<App>` and the path-keyed `RoutedBoundary`, so each route gets its own
 * isolated failure surface plus a Sentry tag identifying which route blew up.
 *
 * Why both layers: a single per-Routes boundary catches the crash but
 * doesn't preserve a per-route reset boundary instance, which means React
 * tears the whole crashed subtree down and remounts every sibling lazy
 * chunk on retry. Wrapping each `<Route>` element individually lets the
 * user hit "Try again" without re-importing every other page's chunk.
 */

interface InnerProps {
  children: React.ReactNode;
  pathname: string;
  onGoHome: () => void;
}

interface InnerState {
  hasError: boolean;
  error: Error | null;
}

class RouteErrorBoundaryInner extends React.Component<InnerProps, InnerState> {
  constructor(props: InnerProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): InnerState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // `report()` fans out to Sentry, PostHog, and the Supabase error_logs
    // table. The `route` tag lands on the Sentry event so we can slice
    // issue volume by route in the dashboard.
    report(error, {
      severity: "error",
      tags: { source: "RouteErrorBoundary", route: this.props.pathname },
      context: { componentStack: errorInfo.componentStack },
    });
  }

  componentDidUpdate(prevProps: InnerProps) {
    // Navigating away from a crashed route should clear the error so the
    // user doesn't get trapped on the fallback if they hit "Go home" or
    // any other in-app link.
    if (this.state.hasError && prevProps.pathname !== this.props.pathname) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-5 p-8 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.12)",
            color: "hsl(var(--burnt-sienna))",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px hsl(var(--olivewood) / 0.20)",
          }}
        >
          <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <div className="space-y-1.5 max-w-md">
          <span
            className="font-serif italic uppercase block"
            style={{
              fontSize: "0.62rem",
              color: "hsl(var(--burnt-sienna) / 0.78)",
              letterSpacing: "0.18em",
            }}
          >
            A hiccup
          </span>
          <h3
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.35rem, 2.2vw + 0.4rem, 1.7rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            This page hit a problem.
          </h3>
          <p
            className="font-serif italic leading-relaxed"
            style={{
              fontSize: "0.92rem",
              color: "hsl(var(--olivewood) / 0.75)",
            }}
          >
            We've logged it. Try again or head back home.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="bark"
            onClick={this.handleReset}
            className="rounded-ds-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={this.props.onGoHome}
            className="rounded-ds-md"
          >
            <Home className="h-4 w-4 mr-2" />
            Go home
          </Button>
        </div>
      </div>
    );
  }
}

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
}

const RouteErrorBoundary = ({ children }: RouteErrorBoundaryProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <RouteErrorBoundaryInner
      pathname={location.pathname}
      onGoHome={() => navigate("/")}
    >
      {children}
    </RouteErrorBoundaryInner>
  );
};

export default RouteErrorBoundary;
