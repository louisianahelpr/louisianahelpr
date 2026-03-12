import { RefreshCw } from "lucide-react";
import { forwardRef } from "react";

interface PullToRefreshWrapperProps {
  pullDistance: number;
  refreshing: boolean;
  isPulling: boolean;
  children: React.ReactNode;
}

const PullToRefreshWrapper = forwardRef<HTMLDivElement, PullToRefreshWrapperProps>(
  ({ pullDistance, refreshing, isPulling, children }, ref) => (
    <div ref={ref} className="relative overflow-auto">
      {(isPulling || refreshing) && (
        <div
          className="flex items-center justify-center transition-all duration-200"
          style={{ height: refreshing ? 48 : pullDistance }}
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
        </div>
      )}
      {children}
    </div>
  )
);

PullToRefreshWrapper.displayName = "PullToRefreshWrapper";

export default PullToRefreshWrapper;
