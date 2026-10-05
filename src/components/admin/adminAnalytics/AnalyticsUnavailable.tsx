import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell } from "@/components/admin/AdminViewShell";

/**
 * Admin analytics when its load has nothing to show: offline (Q571) or failed
 * (Q1140). Either way the figures did not load, so the page says so instead of
 * painting $0.00 money tiles.
 */
export function AnalyticsUnavailable({ offline = false, onRetry }: { offline?: boolean; onRetry: () => void }) {
  return (
    <AdminViewShell>
      {offline ? (
        <OfflineEmptyState
          body="Analytics will load here as soon as you're back online. These figures did not load; they are not zero."
          onRetry={onRetry}
        />
      ) : (
        <ErrorState
          variant="inline"
          title="We couldn't load analytics."
          body="Tap Try again. These figures did not load; they are not zero."
          onRetry={onRetry}
        />
      )}
    </AdminViewShell>
  );
}
