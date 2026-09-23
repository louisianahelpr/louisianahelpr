import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

interface NotificationPayload {
  user_id: string;
  title: string;
  message: string;
  type?: string;
  link?: string | null;
  /**
   * The job this notification is about. PASS IT whenever one is in scope —
   * including when `link` points somewhere that is not a job (`/earnings` for
   * a payout, `/admin` for an operator alert). It is the reference the reader
   * resolves their destination from (notificationDestination.ts), and it is
   * the only way a notification whose link carries no id can name its job.
   *
   * Omitting it is safe but lossy: a `trg_notifications_fill_job_id` trigger
   * recovers the job from a link that already carries one (`?job=`,
   * `?jobId=`, `?quickApply=`, `/jobs/<id>`), so a job-shaped link still ends
   * up with a job_id. A link with no id in it cannot be recovered at all.
   */
  job_id?: string | null;
}

/**
 * ADMIN ONLY (Q223): free-text notifications. The server refuses caller-written
 * copy from anyone else — a counterparty uses `notifyJobParty` below.
 *
 * Creates an in-app notification via the create-notification edge function
 * (server-side insert). The EMAIL is chained inside that function with the
 * service key — never from here. send-notification-email is service-role-only
 * (it will send arbitrary HTML as Helpr, so it must not trust a user JWT);
 * the old client-side invoke could only ever 401, which meant every
 * client-driven lifecycle email silently failed AND each failure fanned an
 * "Email delivery failed" notification out to every admin.
 */
export async function createNotification(payload: NotificationPayload) {
  const { user_id, title, message, type = "info", link = null, job_id = null } = payload;

  const { error: fnError } = await supabase.functions.invoke("create-notification", {
    body: { user_id, title, message, type, link, job_id },
  });

  if (fnError) {
    report(fnError, { tags: { source: "createNotification.insert" } });
    return { error: fnError };
  }

  return { error: null };
}

/**
 * The notifications a NON-ADMIN may cause another user to receive (Q223).
 * Mirrors NOTIFICATION_TEMPLATES in
 * supabase/functions/_shared/notification-templates.ts — the server builds
 * every word, the type and the link from the job; the client only says which
 * event happened and on which job.
 */
export type NotificationTemplate =
  | "work_started"
  | "dispute_withdrawn"
  | "dispute_response"
  | "revision_acknowledged"
  | "job_confirmed"
  | "dispute_resolved"
  | "revision_requested"
  | "arrival_confirmed"
  | "work_confirmed"
  | "job_offer"
  | "application_declined"
  | "no_show_reported";

/**
 * Notify the other party of a job about a lifecycle event. Free-text
 * `createNotification` is admin-only on the server; this is the path for
 * everyone else.
 */
export async function notifyJobParty(payload: {
  user_id: string;
  job_id: string;
  template: NotificationTemplate;
}) {
  const { error: fnError } = await supabase.functions.invoke("create-notification", {
    body: { user_id: payload.user_id, job_id: payload.job_id, template: payload.template },
  });
  if (fnError) {
    report(fnError, { tags: { source: "notifyJobParty.insert" }, context: { template: payload.template } });
    return { error: fnError };
  }
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
