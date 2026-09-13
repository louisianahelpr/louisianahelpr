import { AlertTriangle } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { report } from "@/lib/errorLogger";
import { currentScreen } from "@/lib/currentScreen";
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
  /** Surface override — forwarded to EmptyState. Same contract and the same
   *  narrow licence: only for a caller that deliberately runs a different
   *  card material. The admin console uses it to flatten this card when it
   *  is nested inside an `AdminCard`, which would otherwise draw a white
   *  tile inside a white tile. Optional, so every existing call site is
   *  unaffected. */
  surfaceStyle?: CSSProperties;
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
  surfaceStyle,
}: ErrorStateProps) {
  // Every rendered error surface is a reported event. The failing query is
  // usually reported by the QueryCache hook in src/lib/queryClient.ts, but
  // forty callers reach this card from props, manual state or a hook in
  // another file, and none of those paths say "a person saw an error
  // screen". This does, once per mount, tagged with the screen and the
  // title the person read — that is what the prod-errors alert counts.
  // Skipped offline: no connection is not a defect (matches the boundaries).
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    report(new Error(`Error screen shown: ${title}`), {
      severity: "warning",
      tags: { source: "ErrorState", screen: currentScreen(), title },
    });
  }, [title]);
  return (
    <EmptyState
      icon={AlertTriangle}
      variant={variant}
      surfaceStyle={surfaceStyle}
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
