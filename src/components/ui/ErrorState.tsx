import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";

interface ErrorStateProps {
  /** Small uppercase serif eyebrow above the title. */
  eyebrow?: string;
  /** Bold display-italic headline. */
  title?: string;
  /** Supporting sentence under the title. */
  body?: string;
  /** When provided, renders a retry button wired to this handler. */
  onRetry?: () => void;
  /** Label for the retry button. */
  retryLabel?: string;
  /** Disables the retry button (e.g. while a retry is in flight) so a
   *  fast double-tap can't fire two fetches. */
  retryDisabled?: boolean;
  /** Optional secondary affordance rendered below retry, so a persistent
   *  failure isn't a dead end (e.g. "Browse helprs"). */
  secondaryAction?: React.ReactNode;
  /** Card treatment — forwarded to EmptyState. Defaults to `dock`. */
  variant?: "dock" | "inline";
}

/**
 * ErrorState — a thin specialization of EmptyState for failed data
 * fetches. Same frosted card, but with an alert icon and an optional
 * retry button, so a fetch error reads as recoverable rather than as a
 * confusing "nothing here yet" empty state.
 *
 * Like EmptyState, the caller supplies the flex wrapper that sizes it.
 */
export function ErrorState({
  eyebrow = "Hiccup on our end",
  title = "We couldn't load this.",
  // Default body avoids blaming the user's connection — many of the
  // failures we see in error_logs are server-side (RLS regressions, RPC
  // grant misses, edge-function timeouts), so "check your connection" sent
  // users hunting for a problem that wasn't theirs to fix. See PR #357 for
  // the dashboard-specific fix this generalizes.
  body = "Tap Try again. If it sticks, our end is having a hiccup — not yours.",
  onRetry,
  retryLabel = "Try again",
  retryDisabled = false,
  secondaryAction,
  variant = "dock",
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={AlertTriangle}
      variant={variant}
      eyebrow={eyebrow}
      title={title}
      body={body}
      action={
        onRetry || secondaryAction ? (
          <div className="flex flex-col items-center gap-2.5 w-full">
            {onRetry && (
              <BarkPillButton onClick={onRetry} disabled={retryDisabled}>
                {retryLabel}
              </BarkPillButton>
            )}
            {secondaryAction}
          </div>
        ) : undefined
      }
    />
  );
}

export default ErrorState;
