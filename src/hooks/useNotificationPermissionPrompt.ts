import { useCallback, useEffect, useState } from "react";
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

/** localStorage key — dismissal timestamp, so the banner doesn't loop
 *  back on every render after the user has closed it. */
const PROMPT_DISMISSED_KEY = "helpr_first_action_prompt_dismissed_at";

/** 30-day snooze, matching the existing PushNotificationPrompt cooldown. */
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** Record that the user just did a job action. Idempotent — once set,
 *  the timestamp is the first such action's time. */
const markJobActionPerformed = (now: number = Date.now()): void => {
  if (safeStorage.getItem(FIRST_JOB_ACTION_KEY)) return;
  safeStorage.setItem(FIRST_JOB_ACTION_KEY, String(now));
};

/** Read-only check used by the hook. Exposed for tests. */
const hasPerformedJobAction = (): boolean =>
  !!safeStorage.getItem(FIRST_JOB_ACTION_KEY);

/** Pure resolver — exported for unit tests. */
const resolveShouldPrompt = (now: number = Date.now()): boolean => {
  if (!hasPerformedJobAction()) return false;
  const dismissed = safeStorage.getItem(PROMPT_DISMISSED_KEY);
  if (dismissed) {
    const parsed = parseInt(dismissed, 10);
    if (Number.isFinite(parsed) && now - parsed < SNOOZE_MS) return false;
  }
  return true;
};

interface PermissionPromptState {
  /** True when the page should surface the notification opt-in. */
  shouldPrompt: boolean;
  /** Snooze the prompt for 30 days. */
  dismiss: () => void;
}

export const useNotificationPermissionPrompt = (): PermissionPromptState => {
  // Render-time read; the underlying flag changes only on user action
  // (post / apply), so we re-derive on a focused window event rather
  // than polling.
  const [shouldPrompt, setShouldPrompt] = useState<boolean>(() => resolveShouldPrompt());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const recompute = () => setShouldPrompt(resolveShouldPrompt());
    window.addEventListener("focus", recompute);
    // The apply / post-job mutations dispatch this synthetic event the
    // moment they call `markJobActionPerformed` so the dashboard
    // doesn't have to wait for a navigation or window-focus to surface
    // the prompt.
    window.addEventListener("helpr:job-action-performed", recompute);
    return () => {
      window.removeEventListener("focus", recompute);
      window.removeEventListener("helpr:job-action-performed", recompute);
    };
  }, []);

  const dismiss = useCallback(() => {
    safeStorage.setItem(PROMPT_DISMISSED_KEY, String(Date.now()));
    setShouldPrompt(false);
  }, []);

  return { shouldPrompt, dismiss };
};

/**
 * Convenience helper for call sites — fires `markJobActionPerformed`
 * and dispatches the synthetic event the hook listens for so the
 * dashboard surfaces the prompt on the next paint without a route
 * change. Safe to call multiple times.
 */
export const recordJobActionForPermissionPrompt = (): void => {
  if (hasPerformedJobAction()) return;
  markJobActionPerformed();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("helpr:job-action-performed"));
  }
};
