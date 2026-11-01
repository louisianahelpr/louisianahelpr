// Web push, the two React halves (owner approved 2026-10-29, B58's plan):
//
//   useWebPushBootSync(userId) - signed in with permission already granted: make
//     sure this browser's subscription row exists (boot upsert).
//   useWebPushAskAfterJobAction() - after a member posts a job or applies
//     ("helpr:job-action", dispatched by recordJobActionForPermissionPrompt),
//     show the in-app notifications sheet. The browser's prompt is raised only
//     by the sheet's button (a tap), never automatically. On iPhone Safari
//     outside the Home Screen, where Apple offers no web push, the sheet says
//     how to add Helpr to the Home Screen instead.
//
// Both are web only; the native app has its own APNs path (nativePush.ts).
import { useEffect } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { track } from "@/lib/analytics";
import { explainPermission } from "@/hooks/usePermissionRationale";
import { waitForNoModal } from "@/lib/pushPermissionNudge";
import { hasWebPushApis, isIosOutsideHomeScreen, subscribeWebPushOnUse } from "@/lib/webPushSupport";
import { JOB_ACTION_EVENT } from "@/hooks/useNotificationPermissionPrompt";

export const WEB_PUSH_ASKED_KEY = "web-push-asked-at";
/** One ask per 14 days, like the Activity nudges (pushPermissionNudge.ts). */
export const WEB_PUSH_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function useWebPushBootSync(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId || !hasWebPushApis()) return;
    // Loads webPush.ts on use; reports its own failures (a failed chunk too) and never throws.
    void subscribeWebPushOnUse();
  }, [userId]);
}

/** What the sheet after a job action should be: the ask, the Home Screen hint, or nothing. */
export function webPushAskKind(now: number = Date.now()): "ask" | "home_screen" | null {
  const last = Number(safeStorage.getItem(WEB_PUSH_ASKED_KEY) ?? 0);
  if (Number.isFinite(last) && last > 0 && now - last < WEB_PUSH_ASK_COOLDOWN_MS) return null;
  if (hasWebPushApis()) return Notification.permission === "default" ? "ask" : null;
  return isIosOutsideHomeScreen() ? "home_screen" : null;
}

/** One ask at a time: a Sell a bunch publishes several items in a row, each offering the ask (PUSH-REACH). */
let askInFlight = false;

export async function offerWebPushAfterJobAction(): Promise<void> {
  if (askInFlight) return;
  const kind = webPushAskKind();
  if (!kind) return;
  askInFlight = true;
  try {
    await askOnce(kind);
  } finally {
    askInFlight = false;
  }
}

async function askOnce(kind: "ask" | "home_screen"): Promise<void> {
  // Never over the job's own confirmation dialog; skip (and ask next time) if one stays open.
  if (!(await waitForNoModal(60_000))) return;
  safeStorage.setItem(WEB_PUSH_ASKED_KEY, String(Date.now()));
  // PUSH-REACH: the ask's funnel is recorded, so "2 web subscriptions" can be told apart into never asked,
  // asked and said no, said yes but the save failed, or an iPhone outside the Home Screen.
  track("web_push_ask", { kind, step: "shown" });
  if (kind === "home_screen") {
    await explainPermission("notifications_home_screen", () => {});
    return;
  }
  const agreed = await explainPermission("notifications", async () => {
    // FIRST statement, synchronously inside the sheet button's click: Safari
    // only shows the prompt from a user gesture, and an await before this
    // line would spend it.
    const answer = await Notification.requestPermission();
    track("web_push_ask", { kind, step: "browser_answer", answer });
    if (answer === "granted") {
      const saved = await subscribeWebPushOnUse();
      track("web_push_ask", { kind, step: "saved", result: saved });
    }
  });
  if (!agreed) track("web_push_ask", { kind, step: "not_now" });
}

export function useWebPushAskAfterJobAction(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAction = () => {
      void offerWebPushAfterJobAction();
    };
    window.addEventListener(JOB_ACTION_EVENT, onAction);
    return () => window.removeEventListener(JOB_ACTION_EVENT, onAction);
  }, []);
}
