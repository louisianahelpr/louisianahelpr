import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * What a screen shows when it is offline with nothing loaded (Q332, Q571):
 * never a skeleton (nothing is coming) and never its empty state (we do not
 * know there is nothing). The query resumes by itself when the connection
 * returns (TanStack onlineManager); Try Again asks at once.
 *
 * Pair with useFeedPhase (src/hooks/useFeedPhase.ts): render this when the
 * phase is "offline-empty".
 */
export function OfflineEmptyState({
  body,
  onRetry,
  variant = "inline",
}: {
  /** What will appear here once the connection is back. */
  body: string;
  onRetry: () => void;
  variant?: "dock" | "inline" | "bare";
}) {
  return (
    <EmptyState
      variant={variant}
      icon={WifiOff}
      title="You're offline."
      body={body}
      action={
        <Button variant="outline" size="sm" onClick={onRetry} className="rounded-ds-md">
          Try Again
        </Button>
      }
    />
  );
}
