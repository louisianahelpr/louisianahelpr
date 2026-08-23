import React from "react";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";
import {
  isChunkLoadError,
  hardReloadBypassCache,
  recoverFromChunkError,
} from "@/lib/chunkReload";

// Inline SVGs instead of lucide-react so this class component (which must be
// statically imported) doesn't pull the entire lucide chunk onto the critical
// initial load path. Paths are the canonical lucide v1.x TriangleAlert and
// RefreshCw shapes.
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

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** When this value changes, a caught error is cleared. Pass the route
   *  path so navigating away from a crashed page isn't blocked. */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Ship to Sentry + error_logs + PostHog. Skip stale-chunk noise.
    if (!isChunkLoadError(error)) {
      report(error, {
        severity: "error",
        tags: { source: "ErrorBoundary" },
        context: { componentStack: errorInfo.componentStack },
      });
    }

    // Auto-recover from stale chunk errors. Purge SW + caches first so
    // the reload actually picks up the new bundle (one-shot 10s guard).
    if (isChunkLoadError(error)) {
      recoverFromChunkError();
    }
  }

  componentDidUpdate(prevProps: Props) {
    // A changing `resetKey` (the route path) clears a caught error, so a
    // crash on one page doesn't trap the user — navigating elsewhere
    // renders a working tree under this still-mounted boundary.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    if (isChunkLoadError(this.state.error)) {
      // Purge SW caches and reload with a cache-buster query param so
      // the browser definitely fetches the new HTML + chunks.
      void hardReloadBypassCache();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const chunkError = isChunkLoadError(this.state.error);

      return (
        <div className="min-h-[300px] flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              background: chunkError ? "hsl(var(--bark) / 0.12)" : "hsl(var(--burnt-sienna) / 0.12)",
              color: chunkError ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))",
              border: `0.5px solid ${chunkError ? "hsl(var(--bark) / 0.22)" : "hsl(var(--burnt-sienna) / 0.24)"}`,
              boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px hsl(var(--olivewood) / 0.20)",
            }}
          >
            {chunkError ? (
              <RefreshCw className="h-6 w-6" strokeWidth={1.75} />
            ) : (
              <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
            )}
          </div>
          <div className="space-y-1.5">
            <h3
              className="font-display italic font-bold leading-tight"
              style={{ fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.55rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              {chunkError ? "Update ready." : "Something went sideways."}
            </h3>
            <p
              className="font-serif italic leading-relaxed max-w-sm mx-auto text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.80)" }}
            >
              {chunkError
                ? "A newer version of the app was just released. Reload to pick it up."
                : this.state.error?.message || "Something caught us off guard — the button below should fix it."}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={this.handleReset}
            className="rounded-ds-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {chunkError ? "Reload" : "Try Again"}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
