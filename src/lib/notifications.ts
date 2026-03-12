import { supabase } from "@/integrations/supabase/client";

interface NotificationPayload {
  user_id: string;
  title: string;
  message: string;
  type?: string;
  link?: string | null;
}

/**
 * Creates an in-app notification and fires off an email notification
 * if the user has email enabled for that notification type.
 * This is fire-and-forget for the email — it won't block or fail the in-app notification.
 */
export async function createNotification(payload: NotificationPayload) {
  const { user_id, title, message, type = "info", link = null } = payload;

  // 1. Always insert the in-app notification
  const { error } = await supabase.from("notifications").insert({
    user_id,
    title,
    message,
    type,
    link,
  });

  if (error) {
    console.error("Failed to create notification:", error);
    return { error };
  }

  // 2. Fire-and-forget: invoke the email notification edge function
  // This checks user preferences server-side and only sends if enabled
  supabase.functions
    .invoke("send-notification-email", {
      body: { user_id, title, message, type, link },
    })
    .then(({ error: fnErr }) => {
      if (fnErr) console.error("Notification email invoke failed:", fnErr);
    })
    .catch((err) => {
      console.error("Notification email invoke error:", err);
    });

  return { error: null };
}

/**
 * Batch create notifications (e.g., for admin alerts).
 * Sends in-app + email for each recipient.
 */
export async function createNotifications(payloads: NotificationPayload[]) {
  const results = await Promise.allSettled(
    payloads.map((p) => createNotification(p))
  );
  return results;
}