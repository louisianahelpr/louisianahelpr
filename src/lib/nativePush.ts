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

let listenersAttached = false;

async function savePushToken(token: string, platform: "ios" | "android") {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("push_tokens" as any).upsert(
      {
        user_id: user.id,
        token,
        platform,
        device_id: platform + "-" + token.slice(0, 8),
        app_version: "1.0.4",
      },
      { onConflict: "user_id,token" },
    );
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
          const platform = ((window as any).Capacitor?.getPlatform?.() ?? "ios") as "ios" | "android";
          await savePushToken(token.value, platform);
        });

        // Token registration failed.
        await PushNotifications.addListener("registrationError", (err) => {
          report(err, { tags: { source: "push.registrationError" } });
        });

        // Foreground notification received — let the in-app toast/badge handle it.
        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          track("push_received_foreground", {
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

        // Universal Links / App Links — handle taps from outside the app.
        const { App } = await import("@capacitor/app");
        await App.addListener("appUrlOpen", (event) => {
          try {
            const url = new URL(event.url);
            track(AhaEvent.AppOpenedFromDeepLink, { host: url.host, path: url.pathname });
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
 * Trigger the OS-level permission prompt. Wrap with usePermissionRationale
 * for a friendly pre-prompt first.
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

/** Remove all device tokens for the current user. Call on sign-out. */
export async function unregisterPushOnSignOut(userId: string) {
  try {
    await supabase.from("push_tokens" as any).delete().eq("user_id", userId);
  } catch { /* ignore */ }
}
