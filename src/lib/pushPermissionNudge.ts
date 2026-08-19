/**
 * pushPermissionNudge — soft re-ask for push permission at high-intent moments.
 *
 * iOS only shows the native permission prompt once. After a deny, the OS
 * silently no-ops `PushNotifications.requestPermissions()` and our existing
 * cold-start `PushNotificationPrompt` banner does nothing useful. The fix is
 * to surface our own toast nudge at the two moments users care most about
 * notifications:
 *
 *   1. Customer just received their first helper bid on a job they posted.
 *   2. Helper just had their first job offer accepted.
 *
 * Tap "Enable" → re-invokes the OS prompt (or surfaces the rationale +
 * Settings hint on iOS where the OS dropped it). Tap "Not now" → records a
 * dismissal timestamp; the nudge is suppressed for 14 days from that point.
 *
 * The 14-day cooldown intentionally undercuts the broader 30-day cooldown
 * used by the cold-start `PushNotificationPrompt` banner — high-intent
 * nudges are MORE valuable than the cold prompt, so they refresh faster.
 *
 * Stored in `safeStorage` (mirrors to Capacitor Preferences so WebKit
 * eviction can't reset the nudge cooldown after a force-quit).
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { safeStorage, trackKey } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";
import { isPushSupported, getPushPermission } from "@/lib/pushNotifications";
import { useRequestPushPermission } from "@/lib/nativePush";

/** localStorage key for the most recent "Not now" tap. */
export const NUDGE_DISMISSED_KEY = "push-nudge-dismissed-at";

/** localStorage key prefix for per-reason "already shown" markers. Each
 *  high-intent reason fires at most once per user, ever — once the nudge
 *  has surfaced for "customer-first-bid" we don't re-show it on every
 *  subsequent fetch of the same first bid. */
export const NUDGE_SHOWN_PREFIX = "push-nudge-shown:";

/** 14 days, in ms. Exported so tests don't drift from the constant. */
export const NUDGE_SUPPRESSION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Reasons we trigger the nudge. Each value is also used as the suffix on
 * the `push-nudge-shown:<reason>` localStorage key so different reasons
 * don't suppress each other.
 */
export type NudgeReason =
  // Named "-bid" from when posters accepted bids; bidding is gone (see
  // PRICING_MODE_REMOVED in BudgetSection) and the trigger is now the first
  // APPLICATION. The key is deliberately NOT renamed — it namespaces a
  // localStorage entry, so changing it would re-show the nudge to every poster
  // who has already dismissed it. The user-facing copy below says "applies".
  | "customer-first-bid"
  | "helper-first-accept";

/**
 * Pure timing-logic check. Returns true if a nudge for `reason` should
 * surface right now, given current storage state and the clock.
 *
 * Does NOT check the OS permission state — that's an async Capacitor call
 * the caller handles separately. Keeping it pure makes the 14-day
 * suppression logic easy to unit-test.
 */
export function shouldShowNudge(reason: NudgeReason, now: number = Date.now()): boolean {
  // Already shown for this reason — never re-show the same one. (User
  // already saw it; they either enabled or dismissed.)
  const shownKey = NUDGE_SHOWN_PREFIX + reason;
  if (safeStorage.getItem(shownKey)) return false;

  // Still inside the 14-day "Not now" cooldown — suppress.
  const ts = safeStorage.getItem(NUDGE_DISMISSED_KEY);
  if (ts) {
    const parsed = parseInt(ts, 10);
    if (Number.isFinite(parsed) && now - parsed < NUDGE_SUPPRESSION_MS) {
      return false;
    }
  }
  return true;
}

/** Record that the user tapped "Not now". */
export function recordNudgeDismissal(now: number = Date.now()): void {
  safeStorage.setItem(NUDGE_DISMISSED_KEY, String(now));
}

/** Mark a reason as already-fired so we don't surface the same one twice. */
export function markNudgeShown(reason: NudgeReason): void {
  const key = NUDGE_SHOWN_PREFIX + reason;
  // Mirror per-reason markers to durable Preferences too — otherwise a
  // WebKit eviction after the user dismisses the helper-first-accept
  // nudge would replay it on the next launch.
  trackKey(key);
  safeStorage.setItem(key, "1");
}

/**
 * Resolve the current push permission state across native + web in a single
 * lookup. Returns:
 *   - "granted"   → already on, do not nudge
 *   - "denied"    → previously declined (iOS will short-circuit the native
 *                   prompt, but we can still surface our toast → Settings)
 *   - "prompt"    → permission not yet decided (web "default", native
 *                   "prompt" or "prompt-with-rationale")
 *   - "unsupported" → no Notification API and no native plugin
 */
export async function readPushPermission(): Promise<
  "granted" | "denied" | "prompt" | "unsupported"
> {
  if (isNativePlatform) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const status = await PushNotifications.checkPermissions();
      // Capacitor returns "granted" | "denied" | "prompt" | "prompt-with-rationale".
      if (status.receive === "granted") return "granted";
      if (status.receive === "denied") return "denied";
      return "prompt";
    } catch {
      return "unsupported";
    }
  }
  if (!isPushSupported()) return "unsupported";
  const p = getPushPermission();
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  if (p === "default") return "prompt";
  return "unsupported";
}

/**
 * Compose the timing check + permission check. Returns true if the nudge
 * should surface right now. Async because we hit the Capacitor permission
 * plugin on native.
 *
 * Skips when:
 *   - this reason has already fired
 *   - the user dismissed any nudge in the last 14 days
 *   - permission is already granted (no value in nudging)
 *   - notifications aren't supported on this platform at all
 */
export async function shouldNudgeForReason(
  reason: NudgeReason,
  now: number = Date.now(),
): Promise<boolean> {
  if (!shouldShowNudge(reason, now)) return false;
  const state = await readPushPermission();
  if (state === "granted" || state === "unsupported") return false;
  return true;
}

/** Copy lives next to the trigger so the toast stays grep-able. */
const COPY: Record<NudgeReason, { title: string; description: string }> = {
  "customer-first-bid": {
    title: "Turn on notifications?",
    description:
      "We'll ping you the moment a Helpr applies or messages — no need to keep checking.",
  },
  "helper-first-accept": {
    title: "Turn on notifications?",
    description:
      "Get pinged when new jobs in your category drop and when the customer messages you.",
  },
};

// In-memory guard against concurrent triggers — two near-simultaneous
// effects (initial fetch + realtime invalidation landing within ms) can
// both await shouldNudgeForReason() before either calls markNudgeShown().
// This module-level set is the synchronous gate that closes that window.
const inFlight = new Set<NudgeReason>();

/**
 * React hook → returns a `trigger(reason)` callback that:
 *   1. Runs the timing + permission guards (skips if granted, already shown
 *      for this reason, or inside the 14-day dismissal cooldown).
 *   2. Shows a branded sonner toast with "Enable" / "Not now" actions.
 *   3. Marks the reason as shown so it never repeats.
 *
 * Designed to be called from existing post-event handlers (e.g. the
 * helper-first-accept analytics block in useActivityActions). The hook
 * itself is cheap — `useRequestPushPermission` returns a stable async
 * function — so it's safe to mount in a hot path.
 *
 * Returns a no-op when called from a non-React context such as a test
 * setup. Tests should target the pure helpers above directly.
 */
export function usePushPermissionNudge() {
  const requestPush = useRequestPushPermission();

  return useCallback(
    async (reason: NudgeReason): Promise<void> => {
      if (inFlight.has(reason)) return;
      inFlight.add(reason);
      try {
        if (!(await shouldNudgeForReason(reason))) return;
        // Mark before showing the toast so durable storage matches the
        // in-memory inFlight guard across reloads — once we've decided
        // to surface this reason, treat it as shown.
        markNudgeShown(reason);

        const { title, description } = COPY[reason];
        toast(title, {
          description,
          duration: 12_000,
          action: {
            label: "Enable",
            onClick: () => {
              // Fire-and-forget — the rationale hook + OS prompt both run
              // inside requestPush. We don't await inside the action
              // because sonner's onClick types as void.
              void requestPush();
            },
          },
          cancel: {
            label: "Not now",
            onClick: () => recordNudgeDismissal(),
          },
          // Recording the dismissal on the cancel action covers the user
          // who taps "Not now"; the auto-dismiss after `duration` does NOT
          // record one (treat that as ambient — the user didn't interact),
          // so the same reason still counts as "already shown" via
          // markNudgeShown() above and won't repeat.
        });
      } catch {
        // A failed permission probe or sonner import error must not
        // crash the calling business-logic path.
      } finally {
        inFlight.delete(reason);
      }
    },
    [requestPush],
  );
}

