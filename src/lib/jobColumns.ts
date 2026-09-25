import type { Database } from "@/integrations/supabase/types";

/**
 * The columns of `public.jobs` a signed-in client may SELECT.
 *
 * WHY THIS LIST EXISTS. `jobs.offered_to_helper_id` (who a direct offer went
 * to) is the poster's and the offered Helpr's business only (owner decision
 * 2026-09-14). RLS is row-level, so migration 20260915045110 withholds that one
 * column with a column privilege: authenticated's table-level SELECT is gone
 * and every OTHER column is granted back by `sync_jobs_select_grants()`.
 *
 * The consequence for this app: `supabase.from("jobs").select("*")` expands to
 * every column, the private one included, and is refused (42501) for the whole
 * query. So a read that wants "the whole row" selects THIS list instead, and
 * the poster / the offered Helpr get the offeree through
 * `fetchJobOfferTargets()` (src/lib/jobOfferTargets.ts).
 *
 * The list is the jobs Row of the generated types minus JOB_PRIVATE_COLUMNS;
 * src/test/offeredHelperPrivacy.test.ts fails when the two drift (a types.ts
 * regen that adds a column must add it here).
 */
export const JOB_PRIVATE_COLUMNS = ["offered_to_helper_id"] as const;

export const JOB_READABLE_COLUMN_LIST = [
  "accepted_at",
  "boost_auto_extended",
  "boost_expires_at",
  "boosted_at",
  "budget",
  "business_id",
  "cancellation_fee",
  "cancellation_fee_status",
  "cancellation_reason",
  "cancelled_at",
  "cancelled_by",
  "category",
  "chargeback_evidence_due_by",
  "client_request_id",
  "commission_tax_amount",
  "completed_at",
  "created_at",
  "credential_tier",
  "customer_fee_amount",
  "customer_id",
  "date_needed",
  "dayof_confirm_reminder_sent_at",
  "dayof_unanswered_poster_alert_sent_at",
  "department",
  "description",
  "direct_offer_expires_at",
  "direct_offer_status",
  "dispute_deadline",
  "dispute_evidence_urls",
  "dispute_helper_response",
  "dispute_reason",
  "dispute_resolved_at",
  "dispute_status",
  "disputed_at",
  "disputed_by",
  "estimated_hours",
  "expires_at",
  "expiring_notif_sent",
  "flag_reasons",
  "has_active_dispute",
  "helper_arrival_verified_at",
  "helper_arrival_near_miss_at",
  "helper_arrival_near_miss_ft",
  "helper_arrived_at",
  "helper_completed_at",
  "helper_confirmed_at",
  "helper_dayof_confirmed_at",
  "helper_fee_percent",
  "helper_id",
  "helper_on_the_way_at",
  "helpers_needed",
  "id",
  "is_auto_created",
  "is_flexible_schedule",
  "is_group_job",
  "is_recurring",
  "is_seed",
  "is_urgent",
  "late_cancellation",
  "latitude",
  "location",
  "longitude",
  "no_show_alert_sent_at",
  "parent_job_id",
  "parish",
  "payment_confirm_notif_sent",
  "payment_status",
  "payout_scheduled_at",
  "photos",
  "platform_fee_amount",
  "platform_fee_percent",
  "poster_completed_at",
  "poster_confirmed_arrival_at",
  "poster_confirmed_at",
  "poster_confirmed_working_at",
  "pricing_mode",
  "proof_after_urls",
  "proof_before_urls",
  "protection_fee",
  "recurrence_days",
  "recurrence_end_date",
  "recurrence_interval",
  "recurrence_weeks",
  "recurring_helper_id",
  "release_last_chance_notif_sent_at",
  "removal_reason",
  "removed_at",
  "removed_by",
  "require_photo_proof",
  "requires_w9",
  "response_deadline",
  "review_reminder_sent",
  "revision_acceptance_deadline",
  "revision_completed_at",
  "revision_count",
  "revision_deadline",
  "revision_note",
  "revision_requested_at",
  "sales_tax_amount",
  "sales_tax_rate",
  "scope_video_url",
  "special_requirements",
  "start_reminder_sent_at",
  "start_time",
  "status",
  "stripe_payment_intent_id",
  "stripe_session_id",
  "title",
  "updated_at",
  "urgent_fee",
  "zip_code",
] as const;

/**
 * Readable jobs columns that are NOT in JOB_READABLE_COLUMN_LIST on purpose:
 * the recurring-series state, read by `fetchJobSeriesState()`
 * (src/lib/jobSeriesState.ts) as a separate, non-fatal enrichment.
 *
 * WHY SEPARATE (deploy order, money/authz review 2026-09-25). A push to main
 * ships the web app (prod-deploy) and the migrations (db-deploy) in parallel.
 * A column in JOB_READABLE_COLUMN_LIST that the web app selects before
 * db-deploy has added it 42703s EVERY read that uses the list (Activity,
 * profile tabs, admin, data export), not just the series cards. Read on its
 * own, a missing column degrades to "no series state" for a few minutes.
 * src/test/offeredHelperPrivacy.test.ts counts these as covered.
 */
export const JOB_SERIES_STATE_COLUMNS = ["series_ended_on"] as const;

/**
 * Comma-joined, ready for `.select(JOB_READABLE_COLUMNS)`.
 *
 * TYPING THE RESULT: cast the rows (`(data ?? []) as Job[]`), do NOT call
 * `PostgrestBuilder.overrideTypes()`. `overrideTypes` is a real method on the
 * live builder, so a source that calls it throws "overrideTypes is not a
 * function" in every spec that hand-rolls a `from().select().eq().order()`
 * mock — and this repo has no single shared mock to teach it to (four suites
 * went red on exactly that). The cast buys the same type and breaks nothing.
 */
export const JOB_READABLE_COLUMNS: string = JOB_READABLE_COLUMN_LIST.join(", ");

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

/** A jobs row as a signed-in client can read it directly. */
export type ReadableJobRow = Omit<JobRow, (typeof JOB_PRIVATE_COLUMNS)[number]>;

/**
 * The rows of a `.select(JOB_READABLE_COLUMNS)` read, typed.
 *
 * supabase-js can only infer a row type from a select whose column list is a
 * LITERAL; ours is a runtime string, so it infers `GenericStringError[]`. This
 * is the one place that conversion is spelled out, rather than an
 * `as unknown as Job[]` at ten call sites.
 */
export const readableJobRows = <T = ReadableJobRow>(data: unknown): T[] => (data ?? []) as T[];

/** The same for a `.single()` / `.maybeSingle()` read. */
export const readableJobRow = <T = ReadableJobRow>(data: unknown): T => data as T;
