/**
 * Native push notifications + deep linking.
 *
 * Wires APNs/FCM via @capacitor/push-notifications. On the web this is
 * a no-op — we already have web push via /sw-push.js.
 *
 * Flow:
 *   1. App boots → useNativePushSetup() runs once.
 *   2. We DO NOT request permission yet (Apple frowns on cold prompts).
 *   3. Call requestPushPermission() from a clear UX moment (e.g. after the
 *      first job is posted) and pre-flight with usePermissionRationale.
 *   4. On grant, the device token is saved to push_tokens.
 *   5. Tapping a push notification opens the app and routes to the link
 *      embedded in the notification's data payload.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { report } from "@/lib/errorLogger";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import {
  isPushSupported,
  registerServiceWorker,
  requestPushPermission as requestWebPushPermission,
} from "@/lib/pushNotifications";

let listenersAttached = false;

// Pending token captured before supabase.auth has restored the session
// from local storage. APNs sometimes delivers the device token in
// <100ms of register() — faster than supabase-js's session hydration —
// so getUser() returns null and we'd lose the token. Buffer it here
// and flush on the next SIGNED_IN auth event.
let pendingToken: { token: string; platform: "ios" | "android" } | null = null;
let authListenerAttached = false;

// App version is exposed on `window.HELPR_BUILD` from main.tsx (set at
// bundle time). This avoids the previous hardcoded "1.0.4" which would
// silently lie after every iOS rebuild. Falls back to "unknown" if the
// global is missing (e.g. in SSR or pre-hydration test contexts).
function currentAppVersion(): string {
  if (typeof window === "undefined") return "unknown";
  return (window as { HELPR_BUILD?: string }).HELPR_BUILD ?? "unknown";
}

async function persistPushToken(userId: string, token: string, platform: "ios" | "android") {
  try {
    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token,
        platform,
        device_id: platform + "-" + token.slice(0, 8),
        app_version: currentAppVersion(),
      },
      { onConflict: "user_id,token" },
    );
    if (error) {
      report(error, { tags: { source: "persistPushToken.upsert" }, context: { userId } });
    }
  } catch (err) {
    report(err, { tags: { source: "persistPushToken" }, context: { userId } });
  }
}

function attachAuthListenerOnce() {
  if (authListenerAttached) return;
  authListenerAttached = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") && session?.user && pendingToken) {
      const { token, platform } = pendingToken;
      pendingToken = null;
      void persistPushToken(session.user.id, token, platform);
    }
  });
}

async function savePushToken(token: string, platform: "ios" | "android") {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await persistPushToken(user.id, token, platform);
      return;
    }
    // Session not yet restored — buffer the token and flush on first auth event.
    pendingToken = { token, platform };
    attachAuthListenerOnce();
  } catch (err) {
    report(err, { tags: { source: "savePushToken" } });
  }
}

/**
 * Mount once at the app root. Sets up listeners but does NOT request
 * permission. Call requestPushPermission() from a UX-appropriate moment.
 */
export function useNativePushSetup() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativePlatform || listenersAttached) return;
    listenersAttached = true;

    let cancelled = false;
    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Token registration succeeded.
        await PushNotifications.addListener("registration", async (token) => {
          // Defensive narrow: getPlatform can technically return 'web',
          // but registration fires only on native — anything other than
          // 'android' falls back to 'ios' (the dominant platform) so we
          // never write platform='web' into push_tokens (which has no
          // sender backend wired).
          const raw = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
          const platform: "ios" | "android" = raw === "android" ? "android" : "ios";
          await savePushToken(token.value, platform);
        });

        // Token registration failed.
        await PushNotifications.addListener("registrationError", (err) => {
          report(err, { tags: { source: "push.registrationError" } });
        });

        // Foreground notification received — let the in-app toast/badge handle it.
        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          track(AhaEvent.PushReceivedForeground, {
            title: notification.title,
            data: notification.data,
          });
        });

        // User tapped a notification while app was in background/closed.
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          track(AhaEvent.AppOpenedFromPush, { action: action.actionId });
          const link = action.notification?.data?.link;
          if (typeof link === "string" && link.startsWith("/")) {
            navigate(link);
          }
        });

        if (cancelled) return;

        // Auto-register on every app boot when permission is already
        // granted. Capacitor's PushNotifications plugin does NOT cache or
        // re-emit the token across app launches — register() must be
        // called each session for the registration event to fire. Without
        // this, users who granted permission previously never get their
        // token persisted (the user-initiated requestPushPermission flow
        // is the only other call site, and it's gated behind a 30-day
        // snooze on the dashboard prompt). Idempotent + fast when already
        // registered.
        try {
          const status = await PushNotifications.checkPermissions();
          if (status.receive === "granted") {
            await PushNotifications.register();
          }
        } catch (regErr) {
          report(regErr, { tags: { source: "push.autoRegister" } });
        }

        if (cancelled) return;

        // Universal Links / App Links — handle taps from outside the app.
        // STRICT: only honor events whose host matches our actual Universal
        // Links domains (see ios/App/App/App.entitlements `applinks:` entries).
        // On TestFlight cold-install, Capacitor sometimes fires appUrlOpen
        // with the install-source URL on initial launch — without this host
        // guard, a stale `/login` or `/whatever` path would yank fresh-install
        // users away from the guest dashboard they were just rendered onto.
        const ALLOWED_HOSTS = new Set(["louisianahelpr.com", "www.louisianahelpr.com"]);
        const { App } = await import("@capacitor/app");
        await App.addListener("appUrlOpen", (event) => {
          try {
            const url = new URL(event.url);
            track(AhaEvent.AppOpenedFromDeepLink, { host: url.host, path: url.pathname });
            if (!ALLOWED_HOSTS.has(url.host)) return;
            // Strip the host, keep the path + query so React Router can handle it.
            const internal = url.pathname + url.search;
            if (internal && internal !== "/") navigate(internal);
          } catch (err) {
            report(err, { tags: { source: "appUrlOpen" }, context: { url: event.url } });
          }
        });
      } catch (err) {
        report(err, { tags: { source: "useNativePushSetup" } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);
}

/**
 * Trigger the OS-level permission prompt directly. Prefer
 * `requestPushPermissionWithRationale` from a React component so the user
 * sees a friendly pre-prompt first (Apple App Review requires this).
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!isNativePlatform) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.requestPermissions();
    if (status.receive === "granted") {
      await PushNotifications.register();
      return true;
    }
    track("permission_denied", { kind: "push" });
    return false;
  } catch (err) {
    report(err, { tags: { source: "requestPushPermission" } });
    return false;
  }
}

/**
 * Hook-friendly variant: shows the in-app rationale dialog FIRST, then
 * (on confirm) triggers the OS-level permission prompt.
 *
 * Works on both native (Capacitor PushNotifications.requestPermissions)
 * and web (Notification.requestPermission, after registering /sw-push.js).
 * Using the same hook for both keeps the rationale UX consistent, which
 * is also what App Review looks for on the native side.
 *
 * Returns false on platforms that don't support notifications at all
 * (e.g. SSR or a browser without the Notification API).
 */
export function useRequestPushPermission() {
  const { request } = usePermissionRationale();
  return async (): Promise<boolean> => {
    if (isNativePlatform) {
      let granted = false;
      await request("notifications", async () => {
        granted = await requestPushPermission();
      });
      return granted;
    }
    if (!isPushSupported()) return false;
    let granted = false;
    await request("notifications", async () => {
      await registerServiceWorker();
      granted = await requestWebPushPermission();
    });
    return granted;
  };
}

/** Remove all device tokens for the current user. Call on sign-out. */
export async function unregisterPushOnSignOut(userId: string) {
  try {
    await supabase.from("push_tokens").delete().eq("user_id", userId);
  } catch { /* ignore */ }
}
