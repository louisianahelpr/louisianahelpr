/**
 * Start the Posted / Working lists' one read, get_my_activity_cores, from the ENTRY on a cold link that opens on a list
 * (B100, Q2708; same idea as jobsPrefetch.ts and declutterItemPrefetch.ts).
 *
 * Measured 11-04 (cwv-lab, prod, 375 Fast 4G + 4x CPU, the test poster): Posted's largest paint (the first card's
 * title) came at 2.84 s, ~170 ms after get_my_activity_cores answered; that read takes ~1 s on the server for this
 * poster and only started at ~1.67 s, after the list's chunk ran and the profile and switches had answered.
 *
 * So the entry sends the SAME RPC (same body: the posted job columns and the readable application columns) with plain
 * fetch, and fetchActivityCores (src/lib/activityCores.ts) takes the answer ONCE, for this member, while fresh
 * (src/lib/activityCoresTake.ts); both cores share it as they share one in-flight read today. No usable session, any
 * failure, or an answer not in the expected shape: the read asks Supabase as before.
 *
 * NOTHING outside the entry's own chunks may import this file (see guestJobsPrefetch.ts). So the column lists are
 * COPIES, and src/boot/activityCoresPrefetch.test.ts holds them equal to the originals.
 */
import { storedSession } from "./storedSession";

export const ACTIVITY_CORES_PREFETCH_KEY = "__lhActivityCoresPrefetch";

/** Copy of POSTED_JOB_COLUMNS (src/lib/activityCores.ts: JOB_READABLE_COLUMN_LIST + three; the test holds them equal). */
export const CORES_JOB_COLUMNS = [
  "accepted_at", "boost_auto_extended", "boost_expires_at", "boosted_at", "budget", "business_id", "cancellation_fee",
  "cancellation_fee_status", "cancellation_reason", "cancelled_at", "cancelled_by", "category",
  "chargeback_evidence_due_by", "client_request_id", "commission_tax_amount", "completed_at", "created_at",
  "credential_tier", "customer_fee_amount", "customer_id", "date_needed", "dayof_confirm_reminder_sent_at",
  "dayof_unanswered_poster_alert_sent_at", "department", "description", "direct_offer_expires_at",
  "direct_offer_status", "dispute_deadline", "dispute_evidence_urls", "dispute_helper_response", "dispute_reason",
  "dispute_resolved_at", "dispute_status", "disputed_at", "disputed_by", "estimated_hours", "expires_at",
  "expiring_notif_sent", "expiring_final_notif_sent", "flag_reasons", "has_active_dispute",
  "helper_arrival_verified_at", "helper_arrival_near_miss_at", "helper_arrival_near_miss_ft", "helper_arrived_at",
  "helper_completed_at", "helper_confirmed_at", "helper_dayof_confirmed_at", "helper_fee_flat_cents",
  "helper_fee_percent", "helper_id", "helper_on_the_way_at", "helpers_needed", "id", "instant_booked_at",
  "instant_decline_until", "is_auto_created", "is_flexible_schedule", "is_group_job", "is_recurring", "is_seed",
  "is_urgent", "late_cancellation", "latitude", "location", "longitude", "no_show_alert_sent_at", "parent_job_id",
  "parish", "payment_confirm_notif_sent", "payment_status", "payout_scheduled_at", "photos", "platform_fee_amount",
  "platform_fee_percent", "poster_completed_at", "poster_confirmed_arrival_at", "poster_confirmed_at",
  "poster_confirmed_working_at", "poster_fee_flat_cents", "pricing_mode", "proof_after_urls", "proof_before_urls",
  "protection_fee", "recurrence_days", "recurrence_end_date", "recurrence_interval", "recurrence_weeks",
  "recurring_helper_id", "release_last_chance_notif_sent_at", "removal_reason", "removed_at", "removed_by",
  "require_photo_proof", "requires_w9", "response_deadline", "review_reminder_sent", "revision_acceptance_deadline",
  "revision_completed_at", "revision_count", "revision_deadline", "revision_note", "revision_requested_at",
  "sales_tax_amount", "sales_tax_rate", "scope_video_url", "special_requirements", "start_reminder_sent_at",
  "start_time", "status", "stripe_payment_intent_id", "stripe_session_id", "title", "updated_at", "urgent_fee",
  "zip_code", "materials_note", "onboarding_fee_amount", "poster_marked_done_at",
];
/** Copy of APPLICATION_READABLE_COLUMN_LIST (src/lib/applicationColumns.ts; the test holds them equal). */
export const CORES_APPLICATION_COLUMNS = [
  "attachment_urls", "closed_reason", "created_at", "decline_reason", "flagged_hidden", "helper_id", "id", "job_id",
  "job_latitude", "job_longitude", "message", "offer_message", "offer_message_flagged_hidden", "poster_viewed_at",
  "stake_amount", "stake_status", "status", "suggested_date", "suggested_start_time", "updated_at",
];

/**
 * True when a cold load draws the Posted or Working list first: /posts (App.tsx sends it to /jobs?tab=posted), /home
 * (Next up and the to-dos read the same cores), or a /jobs link that opens on a list (jobsListRoute.ts jobListsOpenFirst, copied; the test holds them equal).
 */
export function opensOnActivityList(pathname: string, search: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/posts") return true;
  // Home's first content (Next up, the to-dos) is the same read (useActivityData). Builder 3 11-04, cwv-lab Fast 4G
  // + 4x, 375, the test helper: the read started at ~1.01 s, after the app ran, and answered at ~1.8 s (Q2706).
  if (path === "/home") return true;
  if (path !== "/jobs") return false;
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  return tab ? tab === "posted" || tab === "working" : ["job", "filter", "highlight", "q", "quotes"].some((k) => p.has(k));
}

/** Called by the entry (through signedInPrefetch.ts). No-op unless a cold list link with a live session. */
export function startActivityCoresPrefetch(pathname: string, search: string = location.search): void {
  if (!opensOnActivityList(pathname, search) || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const answer = fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/get_my_activity_cores`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${session.token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ p_job_columns: CORES_JOB_COLUMNS, p_application_columns: CORES_APPLICATION_COLUMNS }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
    // A failed prefetch is not an error: the read asks for itself.
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[ACTIVITY_CORES_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, answer };
}
