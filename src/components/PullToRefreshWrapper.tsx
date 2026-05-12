import { RefreshCw } from "lucide-react";
import { forwardRef } from "react";

interface PullToRefreshWrapperProps {
  pullDistance: number;
  refreshing: boolean;
  isPulling: boolean;
  /** True when pullDistance has crossed the trigger threshold. */
  canTrigger?: boolean;
  children: React.ReactNode;
}

const PullToRefreshWrapper = forwardRef<HTMLDivElement, PullToRefreshWrapperProps>(
  ({ pullDistance, refreshing, isPulling, canTrigger = false, children }, ref) => (
    <div ref={ref} className="relative overflow-auto">
      {(isPulling || refreshing) && (
        <div
          className="flex flex-col items-center justify-center gap-1.5 transition-all duration-200"
          style={{ height: refreshing ? 64 : Math.max(pullDistance, 24) }}
        >
          {/* Frosted-circle icon — matches the empty-state icon recipe
              used everywhere else so pull-to-refresh feels native to the
              parchment surface, not like an iOS chrome leak. */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.65)",
              border: `0.5px solid ${canTrigger || refreshing ? "hsl(var(--bark) / 0.30)" : "hsl(var(--olivewood) / 0.14)"}`,
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                "0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
              opacity: Math.min(pullDistance / 40, 1),
            }}
          >
            <RefreshCw
              className={`w-4 h-4 transition-transform ${refreshing ? "animate-spin" : ""}`}
              style={{
                color: canTrigger || refreshing ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.65)",
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
              className="font-serif italic uppercase transition-colors"
              style={{
                fontSize: "0.62rem",
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
