// Push notification capability + permission helpers.
//
// ── Why this file is native-aware ────────────────────────────────────────
// `isPushSupported()` used to be a pure WEB-PUSH capability test:
//
//     "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
//
// Every one of those is false inside Capacitor's iOS WKWebView: there is no
// `PushManager`, no service worker on the `capacitor://` origin, and no
// `Notification` global at all. So the helper returned `false` on the native
// app — the ONLY platform where push actually matters — and every surface
// gated on it was dead code on iOS, including `NotificationPanel`'s
// "Turn on notifications" row (`showPushRow = pushSupported && !pushEnabled`),
// which is the one ungated entry point to enabling push.
//
// Production evidence (2026-08-31): `push_tokens` held zero rows for every
// user, `notification_logs` had never recorded a single `channel='push'` row,
// and `analytics_events` contained zero `permission_denied` /
// `permission_skipped_guest` events despite 311 `platform='ios'` events — the
// OS permission prompt had apparently never been raised in production.
//
// `readPushPermission()` in `pushPermissionNudge.ts` already had the correct
// shape (native branch first, web capability test only as the fallback). This
// file is now consistent with it: NATIVE IS SUPPORTED, and the web capability
// test is only consulted off-native.
//
// Consequence for the rest of this module: every function below can now be
// reached on a platform with no `Notification` global, so each one has to
// branch on native rather than assume the web API exists. Touching
// `Notification.permission` in the iOS WebView is a ReferenceError, not a
// `false`.
import { report } from "@/lib/errorLogger";
import { isNativePlatform } from "@/lib/nativeInit";

/** The three web-push APIs, all required for browser push. Native has none
 *  of them and does not need them — it goes through APNs/FCM instead. */
const hasWebPushApis = (): boolean =>
  typeof window !== "undefined" &&
  "Notification" in window &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

/**
 * Can this platform receive push at all?
 *
 * Native (iOS/Android Capacitor shell) → always true: the
 * `@capacitor/push-notifications` plugin is compiled into the app and APNs /
 * FCM is the delivery channel. Web → the three-API capability test.
 */
export const isPushSupported = (): boolean => isNativePlatform || hasWebPushApis();

export type PushPermissionState = "granted" | "denied" | "default" | "unsupported";

// Native permission state, cached because `getPushPermission()` is SYNCHRONOUS
// (NotificationPanel reads it inside a `useEffect` and again inside a realtime
// callback) while Capacitor's `PushNotifications.checkPermissions()` is async.
// Primed at boot by `useNativePushSetup` and refreshed by
// `requestPushPermission` — both in `nativePush.ts`. Until it is primed we
// report "default" (undecided), which is the safe answer: it never claims a
// permission the user has not granted.
let nativePermission: Exclude<PushPermissionState, "unsupported"> | null = null;

/**
 * Publish the native permission state read from Capacitor so the synchronous
 * `getPushPermission()` can serve it. Called from `nativePush.ts` only.
 */
export const setNativePushPermission = (
  state: Exclude<PushPermissionState, "unsupported">,
): void => {
  nativePermission = state;
};

/** Test seam — resets the cached native state between test cases. */
export const __resetNativePushPermission = (): void => {
  nativePermission = null;
};

export const getPushPermission = (): PushPermissionState => {
  // Native: never touch `Notification` — it does not exist in the iOS
  // WebView and the property read itself would throw.
  if (isNativePlatform) return nativePermission ?? "default";
  if (!hasWebPushApis()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
};

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  // Native ships no service worker — push arrives through the OS, and the
  // `capacitor://` origin cannot host one anyway.
  if (isNativePlatform) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw-push.js");
    return registration;
  } catch (err) {
    report(err, { tags: { source: "pushNotifications.registerSW" } });
    return null;
  }
};

/**
 * WEB-ONLY permission request. The native prompt lives in
 * `nativePush.requestPushPermission()`; calling `Notification.requestPermission()`
 * on native would throw. Gated on the raw web capability test rather than
 * `isPushSupported()` for exactly that reason — `isPushSupported()` is now
 * true on native.
 */
export const requestPushPermission = async (): Promise<boolean> => {
  if (isNativePlatform) return false;
  if (!hasWebPushApis()) return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
};

/**
 * Web local notification, shown when a realtime row arrives while the tab is
 * hidden. On native the OS already delivers a real APNs/FCM notification for
 * the same event, so this is both unnecessary and impossible (no
 * `Notification` global) — return early rather than throw inside the caller's
 * realtime handler.
 */
export const showLocalNotification = (title: string, message: string, link?: string) => {
  if (isNativePlatform || !hasWebPushApis()) return;
  if (Notification.permission !== "granted") return;

  navigator.serviceWorker.ready.then((registration) => {
    registration.showNotification(title, {
      body: message,
      icon: "/apple-touch-icon.png",
      badge: "/favicon-32.png",
      // NO `/dashboard` DEFAULT — a missing link means "no destination", not
      // "the dashboard".
      //
      // This line used to read `link || "/dashboard"`, and `public/sw-push.js`
      // said the same thing, while `NotificationPanel.handleClick` and
      // `nativePush.ts` (which only navigates on a link that
      // `startsWith("/")`) both treat a null link as "go nowhere". So one
      // notification behaved two ways: tapped in the app it stayed put, tapped
      // as a web notification it dropped you on the dashboard. Two of the three
      // implementations, including the native one that actually ships in the
      // iOS app, already agreed on "go nowhere" — and they are the ones that
      // are right. `/dashboard` is a guess, and for the rows in prod that carry
      // `link: null` ("Test from Helpr", "Application declined") it is a wrong
      // guess that costs the reader a page load and their place in the app.
      data: { link: link && link.startsWith("/") ? link : null },
      tag: `helpr-${Date.now()}`,
    });
  });
};
