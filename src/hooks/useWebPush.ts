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
// The boot sync is web only (the native app registers through nativePush.ts). The ask after a job action runs
// in the app too (Q2003, owner 2026-11-03): the same sheet, whose button raises the OS prompt.
import { useEffect } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { track } from "@/lib/analytics";
import { loadModule } from "@/lib/loadModule";
import { readPushPermission, waitForNoModal } from "@/lib/pushPermissionNudge";
import { isNativePlatform } from "@/lib/nativeInit";
import { hasWebPushApis, isIosOutsideHomeScreen, subscribeWebPushOnUse } from "@/lib/webPushSupport";
import { JOB_ACTION_EVENT } from "@/hooks/useNotificationPermissionPrompt";

/**
 * The explainer sheet's module, loaded at the ask (Builder 2, 11-15). SessionManager mounts this hook on every page,
 * so a static import put usePermissionRationale (its copy for every permission) in app-shared, the chunk every page
 * boots with, for an ask that comes after a job action at the earliest. Null when the load came back empty (a
 * recovery reload is under way): the ask is skipped, and comes again after the next job action.
 */
const loadExplainer = () => loadModule(() => import("@/hooks/usePermissionRationale")).then((m) => m?.explainPermission ?? null);

/**
 * Owner 11-20 (ease batch, item 3): the ask's words for the action that raised it ("Want a ping when someone
 * applies?"), loaded with the ask (never on a page's first load). Null (no context, or the load came back empty): the
 * sheet's general words.
 */
const loadAskWords = (context: string | null) =>
  context ? loadModule(() => import("@/lib/pushAskWords")).then((m) => m?.pushAskWords(context) ?? null) : Promise.resolve(null);

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

export async function offerWebPushAfterJobAction(context: string | null = null): Promise<void> {
  if (askInFlight) return;
  askInFlight = true;
  try {
    // Q2003 (owner 2026-11-03): the app asks with this same sheet after a post or an application, not with a
    // floating "Get notified?" toast.
    if (isNativePlatform) await askNativeOnce(context);
    else {
      const kind = webPushAskKind();
      if (kind) await askOnce(kind, context);
    }
  } finally {
    askInFlight = false;
  }
}

/** The app: the notifications sheet, then the OS prompt from its button; same 14-day cooldown as the website. */
async function askNativeOnce(context: string | null): Promise<void> {
  const last = Number(safeStorage.getItem(WEB_PUSH_ASKED_KEY) ?? 0);
  if (Number.isFinite(last) && last > 0 && Date.now() - last < WEB_PUSH_ASK_COOLDOWN_MS) return;
  // Undecided only: granted needs no ask, and iOS never shows its prompt again after a refusal.
  if ((await readPushPermission()) !== "prompt") return;
  const { requestPushPermission } = await import("@/lib/nativePush");
  if (!(await waitForNoModal(60_000))) return;
  const [explainPermission, words] = await Promise.all([loadExplainer(), loadAskWords(context)]);
  if (!explainPermission) return;
  const agreed = await explainPermission(
    "notifications",
    async () => {
      const granted = await requestPushPermission();
      track("web_push_ask", { kind: "native", step: "os_answer", answer: granted ? "granted" : "not_granted" });
    },
    { onShown: () => markAskShown("native"), ...(words ? { words } : {}) },
  );
  if (!agreed) track("web_push_ask", { kind: "native", step: "not_now" });
}

/**
 * Q2003 (lead 11-04): the 14-day cooldown starts only once the sheet is on screen. Stamping before it showed let a
 * page that left first (a post handing off to Stripe Checkout) spend the ask on a sheet nobody saw.
 */
function markAskShown(kind: "ask" | "home_screen" | "native"): void {
  safeStorage.setItem(WEB_PUSH_ASKED_KEY, String(Date.now()));
  track("web_push_ask", { kind, step: "shown" });
}

async function askOnce(kind: "ask" | "home_screen", context: string | null = null): Promise<void> {
  // Never over the job's own confirmation dialog; skip (and ask next time) if one stays open.
  if (!(await waitForNoModal(60_000))) return;
  const [explainPermission, words] = await Promise.all([loadExplainer(), kind === "ask" ? loadAskWords(context) : Promise.resolve(null)]);
  if (!explainPermission) return;
  // PUSH-REACH: the ask's funnel is recorded, so "2 web subscriptions" can be told apart into never asked,
  // asked and said no, said yes but the save failed, or an iPhone outside the Home Screen.
  const onShown = () => markAskShown(kind);
  if (kind === "home_screen") {
    await explainPermission("notifications_home_screen", () => {}, { onShown });
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
  }, { onShown, ...(words ? { words } : {}) });
  if (!agreed) track("web_push_ask", { kind, step: "not_now", context });
}

export function useWebPushAskAfterJobAction(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAction = (e: Event) => {
      // Owner 11-20: the action names itself (jobActionEvent), so the ask can say what it is for.
      const context = (e as CustomEvent<{ context?: string | null } | null>).detail?.context ?? null;
      void offerWebPushAfterJobAction(context);
    };
    window.addEventListener(JOB_ACTION_EVENT, onAction);
    return () => window.removeEventListener(JOB_ACTION_EVENT, onAction);
  }, []);
}
