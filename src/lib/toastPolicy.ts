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
 *
 * ===========================================================================
 * WHAT THIS ACTUALLY SUPPRESSES, AND WHAT ESCAPES IT
 * ===========================================================================
 *
 * Read this table before writing ANY confirmation. Four separate lanes worked
 * this out the hard way on 2026-08-30/31 — each by shipping a confirmation
 * into a channel that renders nothing, which in code is indistinguishable from
 * one that renders. `shareNative` even carried a comment claiming its
 * `toast.success("Link copied")` had fixed a "share does nothing" report; the
 * copy landed and nothing appeared, on the exact surface the bug came from.
 *
 *   SUPPRESSED (unless the payload carries an `action`)
 *     toast.success(msg, data)
 *     toast.info(msg, data)
 *     toast.message(msg, data)
 *     successToast()      — src/lib/toast.ts, forwards to toast.success
 *
 *   RENDERS, ALWAYS
 *     toast(msg, data)    — the bare callable
 *     toast.error / toast.warning
 *     toast.promise / toast.loading / toast.custom / toast.dismiss
 *     fireSuccessMoment() — src/lib/successMoment.ts, a full-screen overlay,
 *                           not a toast at all
 *
 * WHY the bare callable escapes when `toast.message` does not, given that the
 * two render an identical toast. Sonner (2.0.8,
 * `node_modules/sonner/dist/index.mjs`) builds its export as
 *
 *     const ToastState = new Observer();
 *     const toastFunction = (message, data) => ToastState.message(message, data);
 *     const toast = Object.assign(toastFunction, {
 *       success: ToastState.success, message: ToastState.message, ... });
 *
 * so the methods are PROPERTIES copied off a singleton observer. Reassigning
 * `toast.success` swaps the property; it does not touch `ToastState.success`,
 * and it does not touch the closure inside `toastFunction`, which calls the
 * observer's own `message` directly. Same for `toast.promise`/`loading`, which
 * call `this.create({ type: 'success' })` on the observer. This is an
 * implementation detail of a dependency, so `toastPolicy.escape.test.ts` pins
 * it against the real sonner build — if an upgrade ever routes the callable
 * through the exported property, every confirmation in the app that relies on
 * it dies silently, and that test is what says so.
 *
 * ===========================================================================
 * WHICH CONFIRMATIONS BELONG IN WHICH CHANNEL
 * ===========================================================================
 *
 * The policy is about NOISE, not about hiding outcomes. Apply one test to
 * every success path: AFTER THIS ACTION, HOW DOES THE USER KNOW IT WORKED?
 *
 *  - The screen answers it — a toggle stays flipped, a row appears, a dialog
 *    closes, a queue item leaves, a tracker step advances. Say nothing. This
 *    is the policy working, and it is the overwhelming majority of cases.
 *  - A toast is the only route BACK — "Attachment removed · Undo", "Applied ·
 *    View". Keep `toast.success` and give it the `action`; that is the
 *    exception documented above, and the action is what makes it pass.
 *  - NOTHING on screen changes at all — a clipboard copy, a file download.
 *    These are the real gap. The bytes left the app and the UI is identical
 *    before and after, so a suppressed toast means the user has no way to
 *    distinguish success from a dead button. Confirm them through the bare
 *    `toast(...)` callable (see `confirmCopied` / `confirmDownloaded` in
 *    src/lib/nativeShare.ts), or with inline DOM state (see ShareJobButton's
 *    "Copied" label). Never `toast.success`.
 *
 * Do NOT reach for `toast.success(msg, { action: { label: "Dismiss" } })` to
 * get past this — a no-op action is a lie about the toast's kind, and it puts
 * a button on a message with nowhere to go. Exactly one site does it today
 * (`CancellationDialog.tsx`, which must state what happened to the poster's
 * money and predates the bare-callable idiom); it is the exception, not the
 * pattern to copy. The bare callable is the supported route.
 */
/**
 * The real, unsuppressed `toast.success`, captured the moment the policy
 * replaces it. `confirmConsequential` renders through THIS rather than the bare
 * `toast()` callable, so a consequential confirmation keeps the success styling
 * — the tinted check icon from `classNames.success` — instead of arriving as a
 * neutral announcement indistinguishable from an informational one.
 */
let realSuccess: typeof toast.success | null = null;

/**
 * CONFIRM AN ACTION WHOSE EFFECT HAPPENS SOMEWHERE THE USER CANNOT SEE.
 *
 * Owner ruling, 2026-09-12: "re-enable success toasts for consequential actions
 * only". Everything else stays suppressed by `applyToastPolicy` below.
 *
 * WHY THE RULING CHANGED. The blanket suppression (2026-08-13) was justified in
 * this file's own header as confirmations that "read as clutter and, once
 * toasts moved to the top of the screen, began covering page headers". On
 * 2026-09-12 every toast moved to the BOTTOM, for exactly that reason — so the
 * second half of the justification no longer holds, and the first half (clutter)
 * is answered by keeping trivial confirmations silent.
 *
 * WHAT IT WAS HIDING. An audit that pressed every control and watched the
 * network found consequential actions reaching the server and showing the user
 * nothing: "Email me a password reset link" really posts to /auth/v1/recover,
 * and the confirmation `Reset link sent to ${email}` was already written at the
 * call site — suppressed, dead code that looked live, exactly as the table above
 * warns. Press it and you cannot tell it worked, so you press it again.
 *
 * THE TEST — use this only when BOTH hold:
 *   1. The effect lands OUTSIDE the user's own screen: an email or message sent
 *      to someone, money that moves or leaves a hold, another person's account
 *      standing changing, or behaviour that changes for every user.
 *   2. Nothing on screen shows it. A row appearing, a toggle staying flipped, a
 *      dialog closing, a tracker step advancing — those ANSWER the question, and
 *      a toast on top of them is the clutter the ruling kept out.
 *
 * If you are reaching for this to confirm a save that the form already reflects,
 * it is the wrong tool. Say nothing; that is the policy working.
 */
export function confirmConsequential(
  message: Parameters<typeof toast.success>[0],
  data?: Parameters<typeof toast.success>[1],
): string | number {
  // Falls back to the live property before the policy is applied (unit tests,
  // Storybook), where `toast.success` is still the real one.
  return (realSuccess ?? toast.success)(message, data);
}

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

  // Capture the genuine renderer BEFORE replacing it. Guarded so a second call
  // (a hot reload, a test that applies the policy twice) does not capture the
  // already-suppressed wrapper and silently turn every consequential
  // confirmation back into a no-op.
  if (realSuccess === null) realSuccess = toast.success;
  toast.success = suppressUnlessActionable(toast.success);
  toast.info = suppressUnlessActionable(toast.info);
  toast.message = suppressUnlessActionable(toast.message);
}
