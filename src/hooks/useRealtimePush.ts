import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  showLocalNotification,
  registerServiceWorker,
  getPushPermission,
} from "@/lib/pushNotifications";
import { channelNonce } from "@/lib/realtimeChannel";

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

    const channel = supabase
      .channel(`push-notifications-${userId}-${channelNonce()}`)
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
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
