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
 * On email failure, an admin notification is created for visibility.
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
    .then(({ error: fnErr, data }) => {
      if (fnErr) {
        console.error("Notification email invoke failed:", fnErr);
        notifyAdminsOfEmailFailure(user_id, title, fnErr.message);
      }
    })
    .catch((err) => {
      console.error("Notification email invoke error:", err);
      notifyAdminsOfEmailFailure(user_id, title, err?.message || "Unknown error");
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

/**
 * Fire-and-forget: notify admins when an email fails to send.
 * Uses a simple debounce key to avoid spamming admin notifications.
 */
// In-memory debounce map (works in PWA/service workers unlike sessionStorage)
const emailFailDebounce = new Map<string, number>();

function notifyAdminsOfEmailFailure(targetUserId: string, emailTitle: string, errorMsg: string) {
  const debounceKey = `email_fail_alert_${targetUserId}`;
  const lastAlert = emailFailDebounce.get(debounceKey);
  if (lastAlert && Date.now() - lastAlert < 60_000) return; // 1min debounce
  emailFailDebounce.set(debounceKey, Date.now());

  // Get admin users and notify them
  supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .then(({ data: admins }) => {
      if (!admins?.length) return;
      const adminNotifications = admins.map((admin) => ({
        user_id: admin.user_id,
        title: "⚠️ Email delivery failed",
        message: `Failed to send "${emailTitle}" email for user ${targetUserId.slice(0, 8)}…: ${errorMsg}`,
        type: "warning" as const,
        link: "/admin",
      }));
      // Insert directly to avoid recursive createNotification calls
      supabase.from("notifications").insert(adminNotifications).then(({ error }) => {
        if (error) console.error("Failed to notify admins of email failure:", error);
      });
    });
}
