import React from "react";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";
import { currentScreen, USER_ERROR_SCREEN } from "@/lib/currentScreen";
import {
  isChunkLoadError,
  hardReloadBypassCache,
  recoverFromChunkError,
  isRecoveryReloadInFlight,
} from "@/lib/chunkReload";
import { ChunkRecoveringState } from "@/components/ChunkRecoveringState";

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
  /** True while a stale-chunk recovery reload is starting or scheduled (Q286). */
  recovering?: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Decided here too, so the first fallback render is already quiet when a
    // recovery reload is in flight (see RouteErrorBoundary).
    return { hasError: true, error, recovering: isRecoveryReloadInFlight() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // A recovery reload is already leaving this page: whatever broke meanwhile
    // is a symptom of it. No card, no report.
    if (isRecoveryReloadInFlight()) {
      if (!this.state.recovering) this.setState({ recovering: true });
      return;
    }
    // A stale chunk gets a bounded schedule of automatic cache-busting reloads
    // (CHUNK_RELOAD_SCHEDULE_MS in chunkReload). While one is starting or
    // scheduled, recoverFromChunkError() returns true and this boundary shows
    // the quiet reloading state (Q286), never the error card. When recovery is
    // over — attempts spent, or offline — this is a real failure and is
    // reported like any other. It used to be skipped unconditionally and shown
    // as "Update ready", a claim that is false in exactly that case (owner,
    // 2026-09-12).
    if (isChunkLoadError(error) && recoverFromChunkError()) {
      this.setState({ recovering: true });
      return;
    }
    report(error, {
      severity: "error",
      tags: { source: "ErrorBoundary", kind: USER_ERROR_SCREEN, screen: currentScreen() },
      context: { componentStack: errorInfo.componentStack },
    });
  }

  componentDidUpdate(prevProps: Props) {
    // A changing `resetKey` (the route path) clears a caught error, so a
    // crash on one page doesn't trap the user — navigating elsewhere
    // renders a working tree under this still-mounted boundary.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, recovering: false });
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
      if (this.state.recovering) return <ChunkRecoveringState />;
      if (this.props.fallback) return this.props.fallback;

      const offline = typeof navigator !== "undefined" && navigator.onLine === false;

      return (
        <div className="min-h-[300px] flex flex-col items-center justify-center gap-4 p-8 text-center bg-background rounded-2xl">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.12)",
              color: "hsl(var(--burnt-sienna))",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
              boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px hsl(var(--olivewood) / 0.20)",
            }}
          >
            <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div className="space-y-1.5">
            <h3
              className="font-display italic font-bold leading-tight"
              style={{ fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.55rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              {offline ? "You're offline." : "Something went sideways."}
            </h3>
            <p
              className="font-sans leading-relaxed max-w-sm mx-auto text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.80)" }}
            >
              {offline
                ? "Reconnect and try again."
                : /* A render error's message is never copy — it is "Can't find
                     variable: x" or "undefined is not an object", and one was
                     shown to a person on /profile?tab=home_history on
                     2026-09-07. The raw error still reaches componentDidCatch
                     and Sentry; the person gets the sentence. */
                  "Something caught us off guard — the button below should fix it."}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={this.handleReset}
            className="rounded-ds-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
