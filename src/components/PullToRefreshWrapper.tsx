import { RefreshCw } from "lucide-react";
import { forwardRef } from "react";

interface PullToRefreshWrapperProps {
  pullDistance: number;
  refreshing: boolean;
  isPulling: boolean;
  /** True when pullDistance has crossed the trigger threshold. */
  canTrigger?: boolean;
  /** Extra classes appended to the root so callers can scope the wrapper
   *  (e.g. flex-1 min-h-0 for use as an inner scroll container). */
  className?: string;
  /** Inline style overrides — used for things Tailwind can't express
   *  (custom safe-area padding on the inner scroll, for example). */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const PullToRefreshWrapper = forwardRef<HTMLDivElement, PullToRefreshWrapperProps>(
  ({ pullDistance, refreshing, isPulling, canTrigger = false, className = "", style, children }, ref) => (
    <div ref={ref} className={`relative overflow-auto ${className}`} style={style}>
      {(isPulling || refreshing) && (
        <div
          // Height tracks `pullDistance`, which is written once per rAF frame
          // during an active drag so the indicator matches the finger exactly
          // (see usePullToRefresh.ts). A CSS transition on that height is
          // fine for the release snap-back, but applying it WHILE isPulling
          // means every one of those per-frame height writes gets eased over
          // 200ms instead of applied instantly — the indicator visibly chases
          // a moving target all the way through the drag instead of tracking
          // the finger 1:1. That reads as laggy/rubbery pull-to-refresh, a
          // separate bug from the frozen-gesture one fixed in bb55f70a6 (that
          // one stopped tracking entirely; this one tracks late). Only
          // transition once the finger has released.
          className={`flex flex-col items-center justify-center gap-1.5 ${
            isPulling ? "" : "transition-all duration-200"
          }`}
          style={{ height: refreshing ? 64 : Math.max(pullDistance, 24) }}
        >
          {/* Frosted-circle icon — matches the empty-state icon recipe
              used everywhere else so pull-to-refresh feels native to the
              parchment surface, not like an iOS chrome leak. */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
            style={{
              background: "var(--surface-premium)",
              border: `0.5px solid ${canTrigger || refreshing ? "hsl(var(--bark) / 0.30)" : "hsl(var(--olivewood) / 0.14)"}`,
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                "0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
              opacity: Math.min(pullDistance / 40, 1),
            }}
          >
            <RefreshCw
              className={`w-4 h-4 motion-safe:transition-transform ${refreshing ? "motion-safe:animate-spin" : ""}`}
              style={{
                color: canTrigger || refreshing ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.8)",
                transform: refreshing
                  ? undefined
                  : `rotate(${Math.min(pullDistance * 3, 360)}deg)`,
              }}
              strokeWidth={2}
            />
          </div>
          {/* Copy label — italic serif so it reads as continuous brand
              language with the rest of the app (was Sans uppercase). */}
          {!refreshing && pullDistance > 30 && (
            <span
              className="font-serif italic uppercase transition-colors text-ds-10"
              style={{
                letterSpacing: "0.18em",
                color: canTrigger ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna) / 0.78)",
                opacity: Math.min((pullDistance - 30) / 30, 1),
              }}
            >
              {canTrigger ? "Release to refresh" : "Pull to refresh"}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  )
);

PullToRefreshWrapper.displayName = "PullToRefreshWrapper";

export default PullToRefreshWrapper;
