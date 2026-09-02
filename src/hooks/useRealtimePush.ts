import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  showLocalNotification,
  registerServiceWorker,
  getPushPermission,
} from "@/lib/pushNotifications";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";

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
    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
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
            showLocalNotification(
              notification.title,
              notification.message,
              notification.link
            );
          }
        }
      ),
      { name: `push-notifications-${userId}` },
    );

    return () => {
      sub.close();
    };
  }, [userId]);
}
