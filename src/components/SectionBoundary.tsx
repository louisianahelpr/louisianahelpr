import React, { Suspense, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";

/**
 * SectionBoundary — scoped <ErrorBoundary> + <Suspense> for a single
 * dashboard / activity / profile section.
 *
 * Why this exists separately from the page-level `ErrorBoundary` in
 * `src/components/ErrorBoundary.tsx`:
 *
 *   * The page-level boundary catches a thrown error from any descendant
 *     and replaces the WHOLE tree with its big "Something went sideways"
 *     hero. Useful as the outer net — useless when only one rail of the
 *     dashboard (recommended jobs, your helpers, etc.) failed and the
 *     rest of the page is fine.
 *
 *   * SectionBoundary keeps siblings rendered. A failing RPC for the
 *     "Recommended" rail now shows a small inline retry card instead of
 *     red-screening the entire Dashboard / Activity / Profile route.
 *
 *   * It also bundles a Suspense fallback (skeleton or null) so each
 *     section can lazy-load independently without the parent needing two
 *     wrappers.
 *
 * Pass `label` for both the inline error copy ("Couldn't load <label>")
 * and the Sentry tag. `fallback` is the Suspense fallback (renders
 * during async chunk fetch / streaming). `errorFallback` overrides the
 * default inline error card if a section needs custom recovery copy.
 */
interface Props {
  /** Human-readable name of the section ("recommended jobs", "your earnings", etc.).
   *  Used in the inline error copy and tagged on the Sentry report. */
  label: string;
  /** Suspense fallback. Default: null (matches existing dashboard
   *  Suspense patterns). Pass a skeleton when the section is the primary
   *  content of a tab. */
  fallback?: ReactNode;
  /** Optional override for the inline error UI. */
  errorFallback?: (args: { reset: () => void; error: Error | null }) => ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Bumped on `Try again` so the children re-mount and re-attempt the
   *  failing data fetch / query. */
  resetCount: number;
}

class SectionErrorBoundary extends React.Component<
  Pick<Props, "label" | "errorFallback" | "children">,
  State
> {
  state: State = { hasError: false, error: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    report(error, {
      severity: "error",
      tags: { source: "SectionBoundary", section: this.props.label },
      context: { componentStack: errorInfo.componentStack },
    });
  }

  handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetCount: prev.resetCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.errorFallback) {
        return this.props.errorFallback({
          reset: this.handleReset,
          error: this.state.error,
        });
      }
      return (
        <div
          className="liquid-glass rounded-2xl p-5 my-3 flex items-start gap-3"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.06)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
          role="alert"
        >
          <div
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.14)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <AlertTriangle className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="font-sans font-semibold leading-tight text-ds-15"
              style={{
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.012em",
              }}
            >
              Couldn't load {this.props.label}.
            </p>
            <p
              className="font-serif italic mt-0.5 text-ds-12"
              style={{
                color: "hsl(var(--olivewood) / 0.8)",
              }}
            >
              The rest of the page is still fine. Tap retry to give this section another shot.
            </p>
            <div className="mt-3">
              <Button
                variant="primary"
                size="sm"
                onClick={this.handleReset}
                className="rounded-ds-md h-8 text-ds-13"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Try Again
              </Button>
            </div>
          </div>
        </div>
      );
    }
    // Re-mounting children when resetCount bumps clears the previous
    // failed state in any descendant React Query / useEffect — without
    // this, a retry of a section whose error came from a queryFn rejection
    // would re-render the same cached error and never re-run the fetch.
    return (
      <React.Fragment key={this.state.resetCount}>{this.props.children}</React.Fragment>
    );
  }
}

export const SectionBoundary = ({
  label,
  fallback = null,
  errorFallback,
  children,
}: Props) => (
  <SectionErrorBoundary label={label} errorFallback={errorFallback}>
    <Suspense fallback={fallback}>{children}</Suspense>
  </SectionErrorBoundary>
);

export default SectionBoundary;
