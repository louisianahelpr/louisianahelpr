import { supabase } from "@/integrations/supabase/client";

interface NotificationPayload {
  user_id: string;
  title: string;
  message: string;
  type?: string;
  link?: string | null;
}

/**
 * Creates an in-app notification via edge function (server-side insert)
 * and fires off an email notification if the user has email enabled.
 * This is fire-and-forget for the email — it won't block or fail the in-app notification.
 * On email failure, an admin notification is created for visibility.
 */
export async function createNotification(payload: NotificationPayload) {
  const { user_id, title, message, type = "info", link = null } = payload;

  // 1. Insert notification via edge function (service_role)
  const { error: fnError } = await supabase.functions.invoke("create-notification", {
    body: { user_id, title, message, type, link },
  });

  if (fnError) {
    console.error("Failed to create notification:", fnError);
    return { error: fnError };
  }

  // 2. Fire-and-forget: invoke the email notification edge function
  supabase.functions
    .invoke("send-notification-email", {
      body: { user_id, title, message, type, link },
    })
    .then(({ error: emailErr }) => {
      if (emailErr) {
        console.error("Notification email invoke failed:", emailErr);
        notifyAdminsOfEmailFailure(user_id, title, emailErr.message);
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
 */
const emailFailDebounce = new Map<string, number>();

function notifyAdminsOfEmailFailure(targetUserId: string, emailTitle: string, errorMsg: string) {
  const debounceKey = `email_fail_alert_${targetUserId}`;
  const lastAlert = emailFailDebounce.get(debounceKey);
  if (lastAlert && Date.now() - lastAlert < 60_000) return;
  emailFailDebounce.set(debounceKey, Date.now());

  // Use edge function to create admin notifications too
  supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .then(({ data: admins }) => {
      if (!admins?.length) return;
      for (const admin of admins) {
        supabase.functions.invoke("create-notification", {
          body: {
            user_id: admin.user_id,
            title: "⚠️ Email delivery failed",
            message: `Failed to send "${emailTitle}" email for user ${targetUserId.slice(0, 8)}…: ${errorMsg}`,
            type: "warning",
            link: "/admin",
          },
        }).catch((err) => {
          console.error("Failed to notify admin of email failure:", err);
        });
      }
    });
}
