import { useEffect, useRef } from "react";
import {
  showLocalNotification,
  registerServiceWorker,
  getPushPermission,
} from "@/lib/pushNotifications";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { getLang } from "@/lib/i18n/language";
import { loadModule, untilReload } from "@/lib/loadModule";

// Loaded alone, then called (dynamicImportThenDoesNoWork): the Spanish notice shapes, for Spanish readers only.
const noticeModule = () => loadModule(() => import("@/lib/i18n/noticeEs"));

/**
 * Listens for new notifications via Supabase Realtime and triggers
 * browser push notifications when the user has granted permission.
 */
export function useRealtimePush(userId: string | null) {
  const swRegistered = useRef(false);

  useEffect(() => {
    if (!userId) return;

    // Register service worker once
    if (!swRegistered.current) {
      registerServiceWorker();
      swRegistered.current = true;
    }

    // No onRecovered: this hook only RAISES a browser notification for a row
    // as it arrives. Replaying the outage's rows as notifications would fire a
    // burst of alerts for things the user has since seen in the panel, which is
    // worse than the gap. NotificationPanel's own channel backfills the list.
    //
    // The `notifications` INSERT binding (user_id=eq.<me>) lives on the ONE
    // shared per-user channel (src/lib/userRealtimeBus.ts, Q105): the nav
    // badges and the bell bind the same rows, and a channel of its own here was
    // a duplicate realtime.subscription row.
    const unsubscribe = subscribeUserRealtime(
      userId,
      "notifications:insert",
      (payload) => {
        const notification = payload.new as {
          title: string;
          message: string;
          link?: string;
        };

        // Only show browser notification if user isn't focused on the tab.
        //
        // Read the permission through `getPushPermission()` rather than
        // touching `Notification.permission` directly: this hook is mounted
        // from Dashboard on EVERY platform, and the iOS WKWebView has no
        // `Notification` global at all — the bare property read was a
        // ReferenceError thrown inside a realtime callback the moment a
        // notification arrived while the app was backgrounded. The helper
        // is native-safe, and `showLocalNotification` is itself a no-op on
        // native (the OS already delivered the real APNs alert).
        if (document.hidden && getPushPermission() === "granted") {
          // F260q (owner 11-11): a Spanish reader gets the notice's known shape in Spanish (noticeEs.ts, loaded
          // only for Spanish readers).
          if (getLang() === "es") {
            // An empty module (a recovery reload is on its way) waits on untilReload(); a failed chunk shows the English.
            void noticeModule()
              .then((m) => m ?? untilReload())
              .then(({ noticeInSpanish }) =>
                showLocalNotification(noticeInSpanish(notification.title), noticeInSpanish(notification.message), notification.link),
              )
              .catch((err: unknown) => {
                console.warn("[i18n] Spanish notice shapes failed to load; showing English", err);
                showLocalNotification(notification.title, notification.message, notification.link);
              });
          } else {
            showLocalNotification(notification.title, notification.message, notification.link);
          }
        }
      },
    );

    return unsubscribe;
  }, [userId]);
}
