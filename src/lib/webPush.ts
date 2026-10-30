// Web push on the website: subscribe this browser, keep its row current, and
// remove it on sign-out (owner approved 2026-10-29, B58's plan).
//
// The browser hands us a PushSubscription bound to the app's VAPID key
// (src/config/webPush.ts); register_push_subscription() keeps it in
// public.push_subscriptions, and send-push-notification sends to it beside the
// native APNs tokens (supabase/functions/_shared/webPush.ts).
//
// Service worker: the website runs ONE service worker, the Workbox /sw.js, with
// the push handlers imported into it (public/sw-push-handlers.js). This module
// only ever waits for it (`navigator.serviceWorker.ready`); it never registers a
// second one. In dev and in the native app there is no service worker, so
// `ready` would never settle: every wait here is bounded.
//
// The browser's own permission prompt is only ever raised from a tap
// (useRequestPushPermissionOutcome in nativePush.ts, after the in-app sheet).
// Nothing here asks: subscribeWebPush() is called only once permission is
// already "granted".
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";
import { VAPID_PUBLIC_KEY } from "@/config/webPush";

const READY_TIMEOUT_MS = 10_000;

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

function vapidKeyBytes(): Uint8Array<ArrayBuffer> {
  const b64 = VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** The one service worker, or null when none is running within the bound (dev, native, blocked). */
async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!hasWebPushApis()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const raw = sub.options?.applicationServerKey;
  if (!raw) return true; // the browser does not say; keep the subscription
  const have = new Uint8Array(raw);
  return have.length === key.length && have.every((b, i) => b === key[i]);
}

export type WebPushSyncResult = "saved" | "no_permission" | "unsupported" | "no_service_worker" | "failed";

/**
 * With permission already granted: make sure this browser is subscribed with
 * the app's key, and save (or refresh) its row. Safe to call on every boot.
 * Never throws; a failure is reported and returned.
 */
export async function subscribeWebPush(): Promise<WebPushSyncResult> {
  if (!hasWebPushApis()) return "unsupported";
  if (Notification.permission !== "granted") return "no_permission";
  try {
    const reg = await readyRegistration();
    if (!reg) return "no_service_worker";
    const key = vapidKeyBytes();
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      // Subscribed under another key (an old one): the sender cannot sign for
      // it, so replace it.
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON();
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? "",
      p_auth: json.keys?.auth ?? "",
      p_user_agent: navigator.userAgent.slice(0, 400),
    });
    if (error) {
      report(error, { severity: "warning", tags: { area: "push", op: "webPushRegister" } });
      return "failed";
    }
    return "saved";
  } catch (err) {
    report(err, { severity: "warning", tags: { area: "push", op: "webPushSubscribe" } });
    return "failed";
  }
}

/**
 * Sign-out: delete this browser's row (while the session still exists, so the
 * signed-in caller's unregister_push_subscription call is allowed) and drop the browser subscription, so
 * the next person to sign in on this browser is never sent the last one's
 * notifications. Never throws; never blocks sign-out.
 */
export async function removeWebPushSubscription(): Promise<void> {
  if (!hasWebPushApis()) return;
  try {
    // getRegistration, not ready: sign-out must not wait up to 10 s for a
    // service worker that is not there.
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    // Members never write the table directly; the RPC removes only the caller's own row. Zero rows is
    // legitimate (never saved, already removed, or taken over since), so the count is not checked.
    const { error } = await supabase.rpc("unregister_push_subscription", { p_endpoint: sub.endpoint });
    if (error) report(error, { severity: "warning", tags: { area: "push", op: "webPushRemove" } });
    await sub.unsubscribe();
  } catch (err) {
    report(err, { severity: "warning", tags: { area: "push", op: "webPushRemove" } });
  }
}
