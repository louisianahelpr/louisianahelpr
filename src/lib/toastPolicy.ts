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
 * Done here rather than by editing ~211 call sites because `toast` is a single
 * shared module instance — patching it once means every caller is covered, no
 * churn, and re-enabling is deleting this file's call. `toast.message` and
 * `toast.info` go too: both are neutral announcements, which is the category
 * being removed. `error` and `warning` are untouched.
 */
export function applyToastPolicy() {
  const noop = () => "" as unknown as string | number;
  toast.success = noop as typeof toast.success;
  toast.info = noop as typeof toast.info;
  toast.message = noop as typeof toast.message;
}
