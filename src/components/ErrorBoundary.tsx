import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Detect "stale chunk" errors caused by a deploy/HMR happening between
 * page load and the user clicking a lazy route. The fix is a hard reload
 * (with a one-shot guard so we never loop).
 */
const isChunkLoadError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg)
  );
};

const RELOAD_FLAG = "helpr_chunk_reload_at";

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);

    // Ship to Sentry + error_logs + PostHog. Skip stale-chunk noise.
    if (!isChunkLoadError(error)) {
      report(error, {
        severity: "error",
        tags: { source: "ErrorBoundary" },
        context: { componentStack: errorInfo.componentStack },
      });
    }

    // Auto-recover from stale chunk errors with a single hard reload.
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0");
      // Only reload if we haven't already tried in the last 10s.
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        window.location.reload();
      }
    }
  }

  handleReset = () => {
    if (isChunkLoadError(this.state.error)) {
      // Hard reload bypasses the cached module map.
      window.location.reload();
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
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">
              {chunkError ? "Update available" : "Something went wrong"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {chunkError
                ? "A newer version of the app was released. Reload to continue."
                : this.state.error?.message || "An unexpected error occurred."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={this.handleReset}>
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
