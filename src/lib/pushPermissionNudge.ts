/**
 * pushPermissionNudge: the push-permission helpers shared by the notifications
 * ask (src/hooks/useWebPush.ts) and the Notifications panel.
 *
 * The floating "Get notified?" toast that used to live here (fired on a
 * poster's first application and a Helpr's first accepted offer) is gone
 * (Q2003, owner 2026-11-03): the app asks with the same in-app sheet as the
 * website, right after the first post or application (useWebPush.ts,
 * offerWebPushAfterJobAction). Guard: src/test/appAsksWithTheSheetNotAToast.test.ts.
 */
import { isNativePlatform } from "@/lib/nativeInit";
import { isPushSupported, getPushPermission } from "@/lib/pushNotifications";

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
      // Silent by design: "unsupported" is a real, expected answer — the push
      // plugin is absent on web and on a native build without the capability.
      // Callers treat it as "do not nudge", which is the quiet direction: the
      // worst outcome is not asking someone to enable notifications.
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
 * After a push request came back NOT granted: should the user be told to go
 * to Settings?
 *
 * Only when the OS/browser actually says no. `useRequestPushPermission`
 * returns `false` for two different things — the user tapping "Not now" in
 * our own rationale dialog (no OS prompt was ever shown; permission is still
 * "prompt") and a real denial. press-every-control (run 34744828202, 2026-09-13)
 * pressed "Not now" and got an ERROR toast, "Notifications are off. Turn them
 * on in your browser settings." — scolding a choice the user just made and
 * pointing at a setting that was never touched. "prompt" is a choice, not a
 * failure: say nothing, and the row stays there for next time.
 */
export function pushDeclineNeedsSettingsHint(state: Awaited<ReturnType<typeof readPushPermission>>): boolean {
  return state !== "prompt" && state !== "granted";
}

/**
 * Q1504: an ask must not sit over an open modal's buttons. Seen at 375 on
 * /posts: this nudge stayed above a BrandConfirmDialog and hid its "Send
 * request" until dismissed. Radix dialogs, alert dialogs and vaul drawers all
 * mark their open content `[role=dialog|alertdialog][data-state=open]`.
 */
export const OPEN_MODAL_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function modalIsOpen(doc: Document = document): boolean {
  return doc.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

/**
 * Resolves true once no modal is open (at once when none is), false if one is
 * still open after `timeoutMs`; the nudge is then skipped and NOT marked shown,
 * so its next trigger can try again.
 */
export async function waitForNoModal(timeoutMs = 120_000, stepMs = 500): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (modalIsOpen()) {
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return true;
}
