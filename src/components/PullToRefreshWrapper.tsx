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
          className="flex flex-col items-center justify-center gap-1 transition-all duration-200"
          style={{ height: refreshing ? 60 : Math.max(pullDistance, 24) }}
        >
          <RefreshCw
            className={`w-5 h-5 text-primary transition-transform ${
              refreshing ? "animate-spin" : ""
            }`}
            style={{
              transform: refreshing
                ? undefined
                : `rotate(${Math.min(pullDistance * 3, 360)}deg)`,
              opacity: Math.min(pullDistance / 60, 1),
            }}
          />
          {/* Copy label so the gesture is discoverable on first use.
              Shown once the user has started pulling enough to see the
              icon clearly (>30px). Refresh state hides the label. */}
          {!refreshing && pullDistance > 30 && (
            <span
              className="text-ds-10 font-sans tracking-wide uppercase transition-colors"
              style={{
                color: canTrigger
                  ? "hsl(var(--primary))"
                  : "hsl(var(--muted-foreground))",
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
