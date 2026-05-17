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
  eyebrow = "Something went wrong",
  title = "We couldn't load this.",
  body = "Check your connection and try again — this is usually a momentary hiccup.",
  onRetry,
  retryLabel = "Try again",
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={AlertTriangle}
      eyebrow={eyebrow}
      title={title}
      body={body}
      action={
        onRetry ? (
          <BarkPillButton onClick={onRetry}>{retryLabel}</BarkPillButton>
        ) : undefined
      }
    />
  );
}

export default ErrorState;
