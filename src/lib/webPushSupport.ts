// The two synchronous web-push checks (does this browser have the APIs; is it
// iPhone Safari outside the Home Screen). Split from webPush.ts so the boot
// path (useWebPush's boot sync, nativePush) carries only these; subscribing and
// removing load webPush.ts on use (bundle budget, 1030d).
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";

/** The three browser APIs web push needs. iPhone Safari has them only in a Home Screen web app. */
export const hasWebPushApis = (): boolean =>
  !isNativePlatform &&
  typeof window !== "undefined" &&
  "Notification" in window &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

/**
 * iPhone/iPad Safari in a normal tab: Apple gives web push ONLY to a site added
 * to the Home Screen (iOS 16.4+), so there is nothing to ask for here; the
 * member is shown how to add Helpr to the Home Screen instead.
 */
export function isIosOutsideHomeScreen(): boolean {
  if (isNativePlatform || typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports itself as a Mac; a touch screen tells them apart.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  if (!ios) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  return !standalone;
}

/** Subscribe (or refresh) this browser, loading webPush.ts first. Never throws: a chunk that fails to load is reported and returns "failed". */
export async function subscribeWebPushOnUse(): Promise<"saved" | "no_permission" | "unsupported" | "no_service_worker" | "failed"> {
  try {
    const { subscribeWebPush } = await import("@/lib/webPush");
    return await subscribeWebPush();
  } catch (err) {
    report(err, { severity: "warning", tags: { area: "push", op: "webPushChunk" } });
    return "failed";
  }
}

/** Sign-out: remove this browser's subscription, loading webPush.ts first. Never throws; never blocks sign-out. */
export async function removeWebPushSubscriptionOnUse(): Promise<void> {
  // removeWebPushSubscription checks hasWebPushApis itself.
  try {
    const { removeWebPushSubscription } = await import("@/lib/webPush");
    await removeWebPushSubscription();
  } catch (err) {
    report(err, { severity: "warning", tags: { area: "push", op: "webPushChunk" } });
  }
}
