/**
 * Push-channel notification logging.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `notification_logs` is the one place an operator can answer "did we actually
 * tell this person?". It has recorded `channel='in_app'` (DB triggers, via
 * `log_notification`) and `channel='email'` (send-notification-email) since
 * 20260418215317. It has never recorded a single `channel='push'` row —
 * verified against prod on 2026-09-01: 137 in_app, 53 email, 0 push.
 *
 * That absence is not a cosmetic gap. Push has never worked in production on
 * this app (the APNs device token was dropped in AppDelegate, so `push_tokens`
 * was unfillable), and the admin log said exactly the same thing about that
 * outage as it would have said about a perfectly healthy push pipeline that
 * simply had a quiet hour: nothing. "Zero push rows" was never evidence,
 * because zero was the only value that column could hold.
 *
 * So every outcome of a push send now lands here on the same footing as email:
 * sent, failed, skipped (and WHY it was skipped), and — the one worth the most
 * — `token_deleted`, one row per device registration that APNs/FCM rejected as
 * permanently dead and that send-push-notification then DELETEd. A user
 * silently losing their push registration is invisible everywhere else in the
 * product and completely explains "push stopped working for me".
 *
 * ── The write is PROVEN, not assumed ───────────────────────────────────────
 * `log_notification` RETURNS void, so a null `error` from it means "the call
 * was made", not "the row exists" — the failure shape CLAUDE.md calls the most
 * common serious bug class in this codebase. `log_push_notification`
 * (20260901004926) RETURNS the inserted uuid instead, and `logPush()` below
 * treats a null/blank id as a failure. That is the edge-function twin of
 * `unwrapMutation()`'s `.select("id")` on the client.
 *
 * ── Deploy-lag ─────────────────────────────────────────────────────────────
 * The RPC is brand new, and edge functions deploy ahead of migrations. A
 * PGRST202 ("function not found") therefore falls back to a direct INSERT with
 * `.select("id")` — same guarantee, no email denormalisation — instead of
 * dropping the log on the floor for the length of the deploy window.
 */

// deno-lint-ignore-file no-explicit-any

/** Statuses this module writes. `token_deleted` is new; the rest match email. */
export type PushLogStatus = "sent" | "failed" | "skipped" | "token_deleted";

/**
 * notification type -> notification_logs.category.
 *
 * Deliberately a copy of `TYPE_MAP` in send-notification-email/index.ts rather
 * than an import: that function is a separately-deployed unit and the shape
 * there also carries `prefCol`, which has no meaning for push (push preferences
 * are resolved in the DB by `fan_out_push_on_notification` before this function
 * is ever called). The CATEGORY halves must stay in step so an operator
 * filtering "Financial" in the admin log sees the email and the push for the
 * same event side by side.
 *
 * The key arrives as the push payload's `thread_id`, which
 * `fan_out_push_on_notification` sets to `notifications.type`.
 */
const CATEGORY_BY_TYPE: Record<string, string> = {
  new_offers: "new_offers",
  transit_updates: "transit_updates",
  work_status: "work_status",
  financial_alerts: "financial_alerts",
  application: "new_offers",
  job_update: "work_status",
  job_updates: "work_status",
  job_match: "new_offers",
  info: "work_status",
  success: "work_status",
  warning: "system",
  system_alert: "system",
  message: "messages",
  payment: "financial_alerts",
  review: "reviews",
  reviews: "reviews",
  promotion: "promotions",
  expired: "work_status",
  verified: "system",
};

/**
 * Best-effort category for a push. Falls back to 'system' — the same bucket
 * send-notification-email's TYPE_MAP defaults to — so a row is never dropped
 * for want of a category, and an unmapped type shows up as System rather than
 * as nothing at all.
 */
export function pushLogCategory(notificationType?: string | null): string {
  if (!notificationType) return "system";
  return CATEGORY_BY_TYPE[notificationType] ?? "system";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pull the job id out of a notification deep link so the log row can be joined
 * to the job it is about.
 *
 * Every Activity-bound notification link is `?job=<uuid>` since
 * 20260831232514 ("notification links land on the right spot"), and messages
 * use the same param. Anything else yields null — a log row with no job_id is
 * normal (system alerts, reviews, promotions), so this never throws or guesses.
 */
export function jobIdFromLink(link?: string | null): string | null {
  if (!link || typeof link !== "string") return null;
  const q = link.indexOf("?");
  if (q === -1) return null;
  const value = new URLSearchParams(link.slice(q + 1)).get("job");
  if (!value || !UUID_RE.test(value)) return null;
  return value;
}

export interface PushLogRow {
  user_id: string;
  /** Raw notification type (the push payload's `thread_id`); mapped internally. */
  notification_type?: string | null;
  status: PushLogStatus;
  /** The push title — what the admin log shows in its Subject column. */
  subject?: string | null;
  /** Deep link, used only to recover `job_id`. */
  link?: string | null;
  /** Failure reason, skip reason, or the APNs/FCM rejection that killed a token. */
  error?: string | null;
}

/**
 * Write ONE `channel='push'` row and return its id, or null if the row could
 * not be written.
 *
 * Never throws. Observability must not be able to fail a delivery: a push that
 * reached the device is still a success even if we could not write it down.
 * But it is never SILENT either — every failure path here console.errors with
 * the `[push-log]` tag, so "the log is missing rows" is itself visible in the
 * edge-function log rather than being indistinguishable from "nothing was
 * sent", which is the exact confusion this whole module exists to end.
 */
export async function logPush(supabase: any, row: PushLogRow): Promise<string | null> {
  const category = pushLogCategory(row.notification_type);
  const jobId = jobIdFromLink(row.link);

  const { data, error } = await supabase.rpc("log_push_notification", {
    _user_id: row.user_id,
    _category: category,
    _status: row.status,
    _subject: row.subject ?? null,
    _job_id: jobId,
    _error: row.error ?? null,
  });

  if (!error) {
    // A void-returning RPC resolves with data === null. This one returns a
    // uuid, so a null here means the INSERT did not produce a row and the
    // "success" is a lie — treat it as a failure rather than reporting a log
    // entry that does not exist.
    if (typeof data === "string" && data.length > 0) return data;
    console.error(
      "[push-log] log_push_notification returned no id — no row was written",
      { user_id: row.user_id, status: row.status },
    );
    return null;
  }

  // PGRST202 = the RPC is not in the schema cache yet. Edge functions deploy on
  // push; migrations deploy on merge via db-deploy.yml, so there is a window
  // where this function is live and the RPC is not. Fall back to the direct
  // INSERT rather than losing the whole window's observability.
  if (error.code !== "PGRST202") {
    console.error("[push-log] log_push_notification failed:", error.message, {
      user_id: row.user_id,
      status: row.status,
    });
    return null;
  }

  // service_role bypasses RLS and additionally holds the explicit INSERT policy
  // from 20260426223249. `recipient_email` is left null here: resolving it would
  // cost a second round-trip on a path that only runs during a deploy window,
  // and the column is nullable and only ever used as a display convenience.
  const { data: inserted, error: insertError } = await supabase
    .from("notification_logs")
    .insert({
      user_id: row.user_id,
      category,
      channel: "push",
      status: row.status,
      subject: row.subject ?? null,
      job_id: jobId,
      error_message: row.error ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[push-log] fallback insert failed:", insertError.message, {
      user_id: row.user_id,
      status: row.status,
    });
    return null;
  }
  if (!inserted?.id) {
    console.error("[push-log] fallback insert returned no id — no row was written", {
      user_id: row.user_id,
      status: row.status,
    });
    return null;
  }
  return inserted.id as string;
}
