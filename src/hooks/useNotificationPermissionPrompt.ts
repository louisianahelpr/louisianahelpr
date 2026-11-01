import { safeStorage } from "@/lib/safeStorage";

/**
 * useNotificationPermissionPrompt
 *
 * Holds the soft "ask for notification permission" off the first
 * launch — that's the moment users are still orienting and a permission
 * prompt feels disconnected from any concrete reason to grant it. The
 * prompt only flips visible after the user has performed their first
 * job action (post or apply), at which point notifications are
 * *obviously* useful to them (new applicant, accept/decline, etc.).
 *
 * State lives in `safeStorage` so it survives WebKit eviction on iOS.
 *
 * Wiring:
 *
 *   1. `markJobActionPerformed()` is called from the apply mutation and
 *      the post-job submit (see Dashboard.tsx + usePostJobForm.ts).
 *   2. `useNotificationPermissionPrompt()` returns `{ shouldPrompt,
 *      dismiss }`. A consumer (e.g. the Dashboard header) reads
 *      `shouldPrompt` and renders `<PushNotificationPrompt />` only when
 *      it's true. `dismiss()` writes a 30-day snooze so the banner
 *      doesn't immediately re-appear after the user closes it without
 *      enabling.
 *
 * Resolution rules (`shouldPrompt`):
 *
 *   * No `helpr_first_job_action_at` flag → false (cold-launch state).
 *   * Flag set AND inside the snooze window → false.
 *   * Otherwise → true.
 *
 * The hook DOES NOT inspect the OS permission state. The
 * `<PushNotificationPrompt />` banner that consumes `shouldPrompt`
 * already handles "permission already granted / denied" gating; this
 * hook only owns the "is now a good time to ask?" question.
 */

/** localStorage key — set the first time the user does anything that
 *  signals notifications would be useful (post a job, apply to a job). */
const FIRST_JOB_ACTION_KEY = "helpr_first_job_action_at";

/** Record that the user just did a job action. Idempotent — once set,
 *  the timestamp is the first such action's time. */
const markJobActionPerformed = (now: number = Date.now()): void => {
  if (safeStorage.getItem(FIRST_JOB_ACTION_KEY)) return;
  safeStorage.setItem(FIRST_JOB_ACTION_KEY, String(now));
};

/** Read-only check used by the hook. Exposed for tests. */
const hasPerformedJobAction = (): boolean =>
  !!safeStorage.getItem(FIRST_JOB_ACTION_KEY);


// The reader half (the useNotificationPermissionPrompt hook and its home
// banner, PushNotificationPrompt) was removed 2026-10-07 at the owner's
// request ("Notify me does not belong there"). The writer below still records
// the first job action; the Activity push nudges (pushPermissionNudge.ts) are
// the remaining opt-in surface.

/**
 * Convenience helper for call sites — fires `markJobActionPerformed`
 * and dispatches the synthetic event the hook listens for so the
 * dashboard surfaces the prompt on the next paint without a route
 * change. Safe to call multiple times.
 */
/** Fired on EVERY job action; the website's push ask listens (useWebPushAskAfterJobAction). */
export const JOB_ACTION_EVENT = "helpr:job-action";

/**
 * PUSH-REACH (measured 11-01 on prod: 2 web subscriptions, 0 native tokens; since web push shipped 10-30 the
 * only asks were after a job post or an application, ~7 signed-in actions in all, while 137 messages were sent):
 * a sent message is where a member most wants to hear the reply, so it offers the website's push ask too. Only the
 * ask's event: it does not mark the first job action (the Activity nudges key on that).
 */
export const offerPushAfterAction = (): void => {
  if (typeof window === "undefined") return;
  const ask = new Event(JOB_ACTION_EVENT);
  window.dispatchEvent(ask);
};

export const recordJobActionForPermissionPrompt = (): void => {
  // Before the first-action early return: the web push ask keeps its own
  // 14-day cooldown and wants every job action (src/hooks/useWebPush.ts).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(JOB_ACTION_EVENT));
  }
  if (hasPerformedJobAction()) return;
  markJobActionPerformed();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("helpr:job-action-performed"));
  }
};
