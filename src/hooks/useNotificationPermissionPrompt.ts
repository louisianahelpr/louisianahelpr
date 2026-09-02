import { useCallback, useEffect, useState } from "react";
import { safeStorage, trackKey } from "@/lib/safeStorage";

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

/* ── Returning-user qualifier ────────────────────────────────────────────
 *
 * The first-job-action gate above is a good idea with too small a mouth. It
 * only opens for a user who posts or applies, and only for one who did so
 * AFTER the flag shipped (2026-08-27) — a helper who browses, saves and
 * messages never trips it, and no pre-existing account has the flag at all.
 * Combined with `isPushSupported()` being false on iOS (fixed 2026-08-31 in
 * src/lib/pushNotifications.ts), it left production with literally no path to
 * the opt-in: zero rows in `push_tokens`, ever.
 *
 * So the banner also qualifies for a RETURNING user — someone who has come
 * back for a second app session. That is deliberately not "first launch":
 * the counter below can only reach 2 on a later cold launch, and the extra
 * hour floor stops a poke-and-relaunch in the first minutes from counting.
 * A returning user has seen enough of the app for "notify me about new jobs"
 * to mean something, which is the same bar the job-action gate was reaching
 * for.
 *
 * This banner is a SOFT prompt: it never raises the OS dialog on its own —
 * only an explicit tap on "Enable" does that (PushNotificationPrompt →
 * useRequestPushPermission → rationale → OS). Widening who sees the pill
 * does not widen who gets asked by iOS, so it cannot burn the one-shot
 * system prompt.
 */

/** localStorage key — first time this device ever mounted the hook. */
const FIRST_SEEN_KEY = "helpr_push_prompt_first_seen_at";

/** localStorage key — count of distinct app sessions that have mounted it. */
const SESSION_COUNT_KEY = "helpr_push_prompt_sessions";

/** Sessions required before a non-job-acting user qualifies. 2 = "came back". */
const RETURNING_SESSION_MIN = 2;

/** Minimum age of the install before the returning-user path opens. Guards
 *  against an immediate relaunch counting as a genuine return. */
const RETURNING_MIN_AGE_MS = 60 * 60 * 1000;

/** Per-JS-runtime guard so a session is counted once, not once per mount.
 *  A Capacitor cold launch is a fresh runtime, which is exactly the
 *  granularity we want. */
let sessionCounted = false;

/** Record this app session. Idempotent within a runtime. */
const recordSession = (now: number = Date.now()): void => {
  if (sessionCounted) return;
  sessionCounted = true;
  trackKey(FIRST_SEEN_KEY);
  trackKey(SESSION_COUNT_KEY);
  if (!safeStorage.getItem(FIRST_SEEN_KEY)) {
    safeStorage.setItem(FIRST_SEEN_KEY, String(now));
  }
  const prev = parseInt(safeStorage.getItem(SESSION_COUNT_KEY) ?? "0", 10);
  safeStorage.setItem(
    SESSION_COUNT_KEY,
    String((Number.isFinite(prev) ? prev : 0) + 1),
  );
};

/** True once the user has come back for a later session on an install that
 *  is more than an hour old. */
const isReturningUser = (now: number = Date.now()): boolean => {
  const sessions = parseInt(safeStorage.getItem(SESSION_COUNT_KEY) ?? "0", 10);
  if (!Number.isFinite(sessions) || sessions < RETURNING_SESSION_MIN) return false;
  const firstSeen = parseInt(safeStorage.getItem(FIRST_SEEN_KEY) ?? "", 10);
  if (!Number.isFinite(firstSeen)) return false;
  return now - firstSeen >= RETURNING_MIN_AGE_MS;
};

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
  // Either qualifier opens the gate: the user did something that makes
  // notifications obviously useful (post / apply), OR they came back for a
  // later session. Both exclude a first launch.
  if (!hasPerformedJobAction() && !isReturningUser(now)) return false;
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
  const [shouldPrompt, setShouldPrompt] = useState<boolean>(() => {
    // Count this session BEFORE resolving, so the session the user comes
    // back in is the session that qualifies rather than the one after it.
    // `recordSession` is idempotent per runtime, so React 18 StrictMode's
    // double-invoked initializer cannot double-count.
    recordSession();
    return resolveShouldPrompt();
  });

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
