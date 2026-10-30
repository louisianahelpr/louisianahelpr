/**
 * UX-7 (owner-approved 2026-10-29: "Review prompts right after I got it / Mark done").
 *
 * The buyer's "I got it" finishes a Declutter sale, and the order card then shows "Leave a review"
 * (DeclutterReviewForm). Waiting for them to spot that button is how most sales went unreviewed, so the
 * tap that finished the sale marks the order here and the review sheet opens by itself the moment the
 * card re-renders as done. Only on this device and only for a short while: a reload, another device or
 * a later visit shows the button as before, never a sheet out of nowhere.
 *
 * Every "I got it" path calls markReviewPrompt (src/test/declutterReviewPromptAfterGotIt.test.ts).
 */
const WINDOW_MS = 2 * 60_000;
const marked = new Map<string, number>();

/** The buyer just confirmed they have the item: open the review sheet when the done card appears. */
export function markReviewPrompt(orderId: string, now: number = Date.now()): void {
  marked.set(orderId, now);
}

/** True while a fresh mark is waiting for this order. Reading does not clear it (StrictMode reads twice). */
export function reviewPromptWaiting(orderId: string, now: number = Date.now()): boolean {
  const at = marked.get(orderId);
  if (at === undefined) return false;
  if (now - at > WINDOW_MS) {
    marked.delete(orderId);
    return false;
  }
  return true;
}

/** The sheet opened (or the review was already sent): the prompt is spent. */
export function clearReviewPrompt(orderId: string): void {
  marked.delete(orderId);
}
