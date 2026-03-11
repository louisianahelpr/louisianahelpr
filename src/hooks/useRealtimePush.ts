import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showLocalNotification, registerServiceWorker } from "@/lib/pushNotifications";

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
      .channel(`push-notifications-${userId}`)
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

          // Only show browser notification if user isn't focused on the tab
          if (document.hidden && Notification.permission === "granted") {
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
