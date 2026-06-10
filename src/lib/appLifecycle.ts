/**
 * Native app-lifecycle bridge.
 *
 * In a Capacitor WKWebView the browser `focus` / `visibilitychange` events
 * do NOT fire reliably when the app returns to the foreground, so
 * TanStack Query's `refetchOnWindowFocus: true` (see queryClient.ts) is
 * effectively dead on iOS — returning to the app shows stale jobs/messages/
 * balances until staleTime + a remount. This hook bridges Capacitor's
 * `appStateChange` into TanStack's `focusManager` so the existing config
 * actually fires a background refetch on foreground. It also clears
 * delivered notifications when the app becomes active so the Notification
 * Center / badge don't pile up after the user has already opened the app.
 *
 * No-op on web (the browser events already work there).
 */
import { useEffect } from "react";
import { focusManager } from "@tanstack/react-query";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";

let attached = false;

async function clearDeliveredNotifications() {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    /* best-effort — never break foreground on a badge cleanup failure */
  }
}

async function clearAppIconBadge() {
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    // Badge throws on devices/platforms without the permission; checking
    // first keeps a denied state from logging on every foreground.
    const { isSupported } = await Badge.isSupported();
    if (!isSupported) return;
    await Badge.clear();
  } catch {
    /* best-effort — the springboard badge isn't worth failing foreground */
  }
}

export function useAppLifecycle() {
  useEffect(() => {
    if (!isNativePlatform || attached) return;
    attached = true;

    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          focusManager.setFocused(isActive);
          if (isActive) {
            void clearDeliveredNotifications();
            void clearAppIconBadge();
          }
        });
        removeListener = () => {
          void handle.remove();
        };
      } catch (err) {
        report(err, { tags: { source: "useAppLifecycle" } });
      }
    })();

    return () => {
      removeListener?.();
      attached = false;
    };
  }, []);
}
