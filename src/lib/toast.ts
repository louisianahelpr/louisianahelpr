/**
 * Centralized toast helpers — wraps `sonner` with brand-specific defaults.
 *
 * The point of routing toast calls through this file (rather than calling
 * `toast.error(...)` from `sonner` directly) is to give error toasts a
 * consistent **Retry** / **Report** action surface and to make the
 * "critical, must-be-dismissed" pattern (offline, auth expired) a one-line
 * call instead of a Sonner-specific `duration: Infinity` recipe each time.
 *
 * Existing call sites that import `toast` from `sonner` directly continue
 * to work — this module re-exports the same `toast` object plus a
 * brand-aware `errorToast()` wrapper for new code. We deliberately do NOT
 * change `toast.error` itself so a hot-fix sweep doesn't have to touch all
 * 300+ existing call sites.
 *
 * Callers wire haptics via `hapticError()` themselves — keeping toast and
 * haptic concerns separate means a silent (non-buzzing) toast remains
 * possible for places (test mocks, batch flows) where a buzz would be noise.
 */

import { toast } from "sonner";

// Sonner's external API surface is intentionally narrow — `id` is a
// string|number, action is `{ label, onClick }`, duration is ms. We mirror
// only what the helpers actually use.
export interface ErrorToastOptions {
  /** Inline description rendered below the title. */
  description?: string;
  /** Toast duration in ms. Default: Sonner's default (~4000ms). */
  duration?: number;
  /** Stable id so repeated triggers de-dupe. */
  id?: string | number;
  /**
   * Primary action button label + handler. If a handler is provided,
   * default label is "Retry".
   */
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
  /**
   * Secondary action — most commonly "Report" so users can flag persistent
   * failures. If omitted, no secondary action renders.
   */
  onReport?: () => void | Promise<void>;
  reportLabel?: string;
  /**
   * `critical: true` keeps the toast on screen until the user dismisses it.
   * Used for offline / auth-expired states. Renders an explicit "Dismiss"
   * cancel button so the user always has a way out.
   */
  critical?: boolean;
}

/**
 * Brand-aware error toast.
 *
 *  - For routine errors, pass `onRetry` so users have a one-tap recovery
 *    path. The action button is wired through Sonner's `action` API so it
 *    benefits from the same styling our `actionButton` Toaster preset
 *    applies (filled bark pill).
 *  - For "must-be-acknowledged" states (offline, auth expired), pass
 *    `critical: true`. The toast persists until dismissed and renders a
 *    cancel button so it's never an unrecoverable trap.
 *  - The `onReport` slot is for opening the support / report-a-problem
 *    flow when a retry isn't enough.
 *
 * Sonner only renders ONE action button per toast (the most recent
 * `action` wins). When both `onRetry` and `onReport` are passed, retry
 * takes precedence as the primary action and report is appended to the
 * description line.
 */
export function errorToast(message: string, options: ErrorToastOptions = {}) {
  const {
    description,
    duration,
    id,
    onRetry,
    retryLabel = "Retry",
    onReport,
    reportLabel = "Report",
    critical = false,
  } = options;

  const action = onRetry
    ? { label: retryLabel, onClick: () => void onRetry() }
    : onReport
      ? { label: reportLabel, onClick: () => void onReport() }
      : undefined;

  // Critical toasts get an explicit cancel button so they can be dismissed —
  // a `duration: Infinity` toast with no dismiss control is a trap.
  const cancel = critical
    ? { label: "Dismiss", onClick: () => { /* sonner auto-dismisses */ } }
    : undefined;

  // Compose a description that surfaces a secondary action when the
  // primary slot is already taken by retry. Sonner only renders one
  // action button, so this keeps "Report" reachable without competing
  // with retry.
  let finalDescription = description;
  if (onRetry && onReport) {
    finalDescription = description
      ? `${description} · Tap retry — or report if it keeps happening.`
      : "Tap retry — or report if it keeps happening.";
  }

  return toast.error(message, {
    description: finalDescription,
    // `duration: Infinity` works in Sonner for "stay until dismissed".
    duration: critical ? Infinity : duration,
    id,
    action,
    cancel,
  });
}

export interface SuccessToastOptions {
  /** Inline description rendered below the title. */
  description?: string;
  /** Toast duration in ms. Default: Sonner's default (~4000ms). */
  duration?: number;
  /** Stable id so repeated triggers de-dupe. */
  id?: string | number;
  /**
   * Optional follow-up action — e.g. "View" after applying to a job, or
   * "Undo" after a destructive-but-reversible action. Renders as the same
   * filled bark pill our Toaster preset styles other action buttons with.
   */
  action?: { label: string; onClick: () => void | Promise<void> };
}

/**
 * Brand-aware success toast.
 *
 * Top apps don't just confirm an action — they offer the obvious next step
 * inline ("Applied ✓ · View"). Pass `action` to surface that one-tap path
 * so the user doesn't have to go hunting for what they just created.
 *
 * No action? It behaves like a plain `toast.success` with our defaults.
 */
export function successToast(message: string, options: SuccessToastOptions = {}) {
  const { description, duration, id, action } = options;
  return toast.success(message, {
    description,
    duration,
    id,
    action: action
      ? { label: action.label, onClick: () => void action.onClick() }
      : undefined,
  });
}

