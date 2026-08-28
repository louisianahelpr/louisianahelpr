import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { useRequestPushPermission } from "@/lib/nativePush";
import { useNotificationPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import {
  readPushPermission,
  recordNudgeDismissal,
  shouldShowNudge,
} from "@/lib/pushPermissionNudge";

/**
 * PushNotificationPrompt — the READER half of the soft push opt-in.
 *
 * History, so this isn't "fixed" back into a loop: this banner shipped on the
 * Dashboard (a21ef33cf), was pulled off the home screen in the 2026-05-29
 * redesign as a *cold-launch* pill that duplicated the empty-state "Notify Me"
 * CTA, and the file was then deleted as a zero-importer in the 2026-07-10 dead
 * sweep. Meanwhile `useNotificationPermissionPrompt` grew the first-job-action
 * gate that answers the original objection: this is no longer a cold prompt —
 * it appears only *after* the user has posted or applied, where the empty-state
 * CTA never renders. Restored 2026-08-27 with the owner's approval, visually
 * unchanged from the original slim pill.
 *
 * Gating, in order (any one of these keeps it hidden):
 *   1. `shouldPrompt` — the user has performed a job action AND is not inside
 *      the hook's 30-day dismissal snooze.
 *   2. `shouldShowNudge` — not inside the 14-day cooldown owned by the
 *      high-intent `usePushPermissionNudge` toasts (Activity's "first
 *      applicant" / "offer accepted"). The two surfaces ask the same question,
 *      so a "Not now" on either one silences both: this banner honours the
 *      nudge cooldown here, and writes one via `recordNudgeDismissal()` when
 *      dismissed. Reason "customer-first-bid" is used only as the cooldown
 *      probe — we never `markNudgeShown()`, so the Activity toasts keep their
 *      own once-ever budget.
 *   3. The OS permission must still be undecided ("prompt"). Already-granted
 *      users have nothing to enable; hard-denied users can't be re-asked (iOS
 *      allows exactly one system dialog and silently no-ops the second), so
 *      showing them an "Enable" button that does nothing is worse than
 *      silence — the Activity toast owns the Settings-hint path for them.
 *
 * The soft prompt gates the system request, never the other way round: the OS
 * dialog is only reached by an explicit tap on Enable.
 */
export const PushNotificationPrompt = () => {
  const [show, setShow] = useState(false);
  const requestPush = useRequestPushPermission();
  // First-job-action gate + 30-day dismissal snooze both live in the hook.
  const { shouldPrompt, dismiss } = useNotificationPermissionPrompt();

  useEffect(() => {
    // Cold launch — the user hasn't posted or applied yet, or they've
    // already snoozed. Skip the ask until they have a concrete reason.
    if (!shouldPrompt) {
      setShow(false);
      return;
    }
    // Don't stack on top of the high-intent nudge's cooldown.
    if (!shouldShowNudge("customer-first-bid")) {
      setShow(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      // Single native+web permission read. Only "prompt" (undecided) earns
      // the banner: "granted" has nothing to offer, "denied" can't be
      // re-asked, "unsupported" has no plugin at all.
      const state = await readPushPermission();
      if (!cancelled) setShow(state === "prompt");
    })();
    return () => {
      cancelled = true;
    };
    // `shouldPrompt` flips the moment a user posts/applies — the hook fires a
    // synthetic event that updates it without a route change.
  }, [shouldPrompt]);

  const handleEnable = async () => {
    // One code path — the hook handles native and web, and shows the
    // rationale dialog before the OS prompt on both.
    await requestPush();
    // Snooze regardless of the outcome: granted users never need it again,
    // and a denied user can't be re-asked by the OS anyway.
    dismiss();
    setShow(false);
  };

  const handleDismiss = () => {
    dismiss();
    // Also silence the high-intent toasts for their 14 days — same question,
    // and the user just answered "not now".
    recordNudgeDismissal();
    setShow(false);
  };

  if (!show) return null;

  return (
    /* Slim single-line banner — was a full three-line card that pushed the
       job feed below the fold. Notification opt-in still has to stay
       surfaced (conversion), so it's compressed rather than removed: one
       row of icon + label + Enable + dismiss. */
    <div
      className="rounded-full liquid-glass pl-2.5 pr-1 py-1 animate-in fade-in slide-in-from-top-1 duration-300"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%)",
      }}
    >
      <div className="flex items-center gap-2">
        <Bell
          className="w-3.5 h-3.5 shrink-0"
          strokeWidth={2.25}
          style={{ color: "hsl(var(--bark) / 0.85)" }}
        />
        <p
          className="flex-1 min-w-0 truncate font-sans font-medium text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Notify me about new jobs.
        </p>
        <button
          type="button"
          onClick={handleEnable}
          className="shrink-0 h-6 px-3 rounded-full text-ds-11 font-sans font-semibold active:scale-[0.97] transition-transform"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(70 22% 24%)",
            letterSpacing: "0.01em",
            boxShadow:
              "inset 0 1px 0 0 rgba(255,255,255,0.12), " +
              "0 1px 2px hsl(var(--bark) / 0.18), " +
              "0 4px 10px -6px hsl(var(--bark) / 0.4)",
          }}
        >
          Enable
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 h-10 w-10 -my-2 -mr-2 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:scale-[0.95] transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
