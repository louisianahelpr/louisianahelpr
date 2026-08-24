import { toast } from "sonner";

/**
 * Success toasts are suppressed app-wide; failures are not.
 *
 * The confirmations ("Job saved", "Availability saved", "Notifications on")
 * read as clutter and, once toasts moved to the top of the screen, began
 * covering page headers. Failures are the opposite: a declined card, a
 * message blocked by the content scan, or a failed payout must not look like
 * nothing happened.
 *
 * Done here rather than by editing the call sites because `toast` is a single
 * shared module instance — patching it once means every caller is covered, no
 * churn, and re-enabling is deleting this file's call. `toast.message` and
 * `toast.info` go too: both are neutral announcements, which is the category
 * being removed. `error` and `warning` are untouched.
 *
 * ONE EXCEPTION — a toast that carries an `action`.
 *
 * Most success toasts only restate what the user just did, so removing them
 * costs nothing. A toast with an `action` is different in kind: the toast IS
 * the affordance. "Attachment removed · Undo" is the only route back from a
 * destructive-but-reversible write, and "Applied ✓ · View" is the only inline
 * path to what was just created. Suppressing those doesn't tidy a
 * confirmation away — it retires a feature, silently, while the code that
 * implements it stays behind looking live. So actionable toasts pass through.
 * Anything with no action is still a confirmation, and still suppressed.
 */
export function applyToastPolicy() {
  const noop = () => "" as unknown as string | number;

  /** Sonner's second argument, narrowed to the part this policy cares about. */
  const carriesAction = (data: unknown): boolean =>
    typeof data === "object" && data !== null && Boolean((data as { action?: unknown }).action);

  const suppressUnlessActionable = <T extends typeof toast.success>(real: T): T =>
    ((message: unknown, data?: unknown) =>
      carriesAction(data)
        ? (real as (m: unknown, d?: unknown) => string | number)(message, data)
        : noop()) as T;

  toast.success = suppressUnlessActionable(toast.success);
  toast.info = suppressUnlessActionable(toast.info);
  toast.message = suppressUnlessActionable(toast.message);
}
