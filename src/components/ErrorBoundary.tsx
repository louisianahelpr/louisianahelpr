import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";

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
    /Loading chunk \d+ failed/i.test(msg) ||
    // Stale React module after HMR / deploy: the previous render's React
    // dispatcher was unmounted while a lazy chunk finished loading, so any
    // hook call (useContext, useState, etc.) sees a null dispatcher. A
    // hard reload re-binds every module to the same React instance.
    /dispatcher\.use[A-Z]\w*/i.test(msg) ||
    /Cannot read propert(y|ies) of null \(reading 'use[A-Z]\w*'\)/i.test(msg) ||
    /null is not an object \(evaluating '[\w.]*dispatcher/i.test(msg) ||
    // Invalid hook call — same root cause (mismatched React instances).
    /Invalid hook call/i.test(msg)
  );
};

const RELOAD_FLAG = "helpr_chunk_reload_at";

/**
 * Force-reload that purges any cached service-worker / Cache Storage entry
 * before navigating. Required when a chunk load error happens because the
 * SW is serving a stale module map; a plain `location.reload()` would just
 * hand back the same stale page.
 */
const hardReloadBypassCache = async () => {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => null)));
    }
  } catch {
    /* swallow — proceed to caches + reload */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => null)));
    }
  } catch {
    /* swallow — proceed to reload */
  }
  // Add a cache-buster query param so the browser fetches fresh HTML
  // instead of serving the cached response.
  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(Date.now()));
  window.location.replace(url.toString());
};

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
    // the reload actually picks up the new bundle.
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0");
      // Only reload if we haven't already tried in the last 10s.
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        void hardReloadBypassCache();
      }
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
            <span
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              {chunkError ? "Fresh paint" : "A hiccup"}
            </span>
            <h3
              className="font-display italic font-bold leading-tight"
              style={{ fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.55rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              {chunkError ? "Update ready." : "Something went sideways."}
            </h3>
            <p
              className="font-serif italic leading-relaxed max-w-sm mx-auto"
              style={{ fontSize: "0.88rem", color: "hsl(var(--olivewood) / 0.80)" }}
            >
              {chunkError
                ? "A newer version of the app was just released. Reload to pick it up."
                : this.state.error?.message || "Something caught us off guard — the button below should fix it."}
            </p>
          </div>
          <Button
            variant="bark"
            onClick={this.handleReset}
            className="rounded-ds-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {chunkError ? "Reload" : "Try again"}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
