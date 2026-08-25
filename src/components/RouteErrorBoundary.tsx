import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";
import {
  isChunkLoadError,
  hardReloadBypassCache,
  recoverFromChunkError,
} from "@/lib/chunkReload";

// Inline SVGs instead of lucide-react so these class components (statically
// imported in App.tsx) don't pull the entire lucide chunk onto the critical
// initial load path. Paths match lucide v1.x TriangleAlert, RefreshCw, House.
interface IconProps { className?: string; strokeWidth?: number }
const AlertTriangle = ({ className, strokeWidth = 2 }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);
const RefreshCw = ({ className, strokeWidth = 2 }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);
const Home = ({ className, strokeWidth = 2 }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

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
  /** True once a stale-chunk hard reload is actually in flight. */
  recovering?: boolean;
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
    // Stale-chunk crashes (a deploy changed the chunk hashes mid-session)
    // aren't real route bugs — they reach this boundary when the user
    // navigates to a lazy route whose chunk 404s. Auto-recover with a
    // one-shot hard reload and skip the Sentry noise. Without this, the
    // user lands on the generic "This page hit a problem" fallback and is
    // stuck until they manually refresh.
    if (isChunkLoadError(error)) {
      // A reload is imminent when this returns true, so the full error card
      // would only flash for a frame or two before the page goes away —
      // which is what the owner was seeing and reasonably read as the site
      // 404ing ("log in also loads 404 error then refreshes to log in").
      // Render a quiet updating state instead. When recovery is NOT started
      // (offline, or the 10s re-entry guard), the real card still shows with
      // its Reload button, because then the user does have to act.
      if (recoverFromChunkError()) this.setState({ recovering: true });
      return;
    }
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
    // A stale-chunk crash can't be cleared by re-rendering the same dead
    // chunk reference — force a cache-busting reload instead.
    if (isChunkLoadError(this.state.error)) {
      void hardReloadBypassCache();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const chunkError = isChunkLoadError(this.state.error);

    // Reload already scheduled — say so plainly and get out of the way.
    if (chunkError && this.state.recovering) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 p-8 text-center" role="status">
          <span style={{ color: "hsl(var(--bark))" }}>
            <RefreshCw className="h-6 w-6 motion-safe:animate-spin" strokeWidth={1.75} />
          </span>
          <p className="font-serif italic text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Updating to the latest version…
          </p>
        </div>
      );
    }

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-5 p-8 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background: chunkError ? "hsl(var(--bark) / 0.12)" : "hsl(var(--burnt-sienna) / 0.12)",
            color: chunkError ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))",
            border: `0.5px solid ${chunkError ? "hsl(var(--bark) / 0.22)" : "hsl(var(--burnt-sienna) / 0.24)"}`,
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px hsl(var(--olivewood) / 0.20)",
          }}
        >
          {chunkError ? (
            <RefreshCw className="h-7 w-7" strokeWidth={1.75} />
          ) : (
            <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
          )}
        </div>
        <div className="space-y-1.5 max-w-md">
          <h3
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.35rem, 2.2vw + 0.4rem, 1.7rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            {chunkError ? "Update ready." : "This page hit a problem."}
          </h3>
          <p
            className="font-serif italic leading-relaxed text-ds-15"
            style={{
              color: "hsl(var(--olivewood) / 0.8)",
            }}
          >
            {chunkError
              ? "A newer version of the app was just released. Reload to pick it up."
              : "We've logged it. Try again or head back home."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            onClick={this.handleReset}
            className="rounded-ds-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {chunkError ? "Reload" : "Try Again"}
          </Button>
          <Button
            variant="outline"
            onClick={this.props.onGoHome}
            className="rounded-ds-md"
          >
            <Home className="h-4 w-4 mr-2" />
            Go Home
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
