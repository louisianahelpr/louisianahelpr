import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q2742 HIGH (Builder 3, 2026-11-05): a SECURITY DEFINER that returns SETOF jobs hands its caller whole jobs rows past
 * RLS. get_jobs_for_my_applications gave every applicant the stripe_*, moderation, dispute and proof columns of every
 * job they applied to (measured on prod read-only: 126 columns; jobs RLS shows an applicant who was not picked no row).
 *
 * THE CLASS: every effective SECURITY DEFINER whose result is SETOF jobs. Each one either overrides the private
 * columns for a caller who is not a party (it names every PRIVATE column in a `CASE WHEN ... THEN '{}'::jsonb ELSE
 * jsonb_build_object(...)` override), or is listed in ROW_VISIBLE_BY_RLS with the reason a plain SELECT on jobs already
 * shows that caller the whole row. The inventory is read from the effective definitions and is EXACT both ways.
 *
 * Behaviour: src/test/pglite/applicantJobsHidePrivateColumns.pglite.mjs (RED 2/2 with --before, all green after,
 * migration applied 3x).
 *
 * @mutate supabase/migrations/20261105102419_applicant_jobs_hide_private_columns.sql |                 'stripe_session_id', NULL,\n | \n
 * @mutate supabase/migrations/20261105102419_applicant_jobs_hide_private_columns.sql |                 'removal_reason', NULL,\n | \n
 * @mutate supabase/migrations/20261105102419_applicant_jobs_hide_private_columns.sql |                 'payout_scheduled_at', NULL,\n | \n
 * @mutate src/integrations/supabase/types.ts | Row: {\n          accepted_at: string \| null\n          boost_auto_extended: boolean | Row: {\n          brand_new_column: string \| null\n          accepted_at: string \| null\n          boost_auto_extended: boolean
 * @mutate supabase/migrations/20261105102419_applicant_jobs_hide_private_columns.sql |            \|\| CASE WHEN e.ok OR j.customer_id = v_uid OR j.helper_id = v_uid THEN |            \|\| CASE WHEN true THEN
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const EFFECTIVE = effectiveDefs(MIGRATIONS);

/** The jobs columns a caller who is not a party to the job never gets (Q2742; + the lead's lh-authz-rls list, 11-05). */
const PRIVATE = [
  "stripe_session_id", "stripe_payment_intent_id", "chargeback_evidence_due_by", "client_request_id", "flag_reasons",
  "removal_reason", "removed_by", "dispute_reason", "dispute_evidence_urls", "dispute_helper_response",
  "cancellation_reason", "revision_note", "proof_before_urls", "proof_after_urls",
  "disputed_by", "dispute_status", "has_active_dispute", "dispute_resolved_at", "disputed_at", "payout_scheduled_at",
  "cancellation_fee_status", "cancelled_by", "helper_arrival_near_miss_ft", "helper_arrival_near_miss_at",
];
/** Masked or caller-scoped by their own override (location to the area, the offeree to the poster and offeree). */
const MASKED = ["location", "latitude", "longitude", "offered_to_helper_id"];
/**
 * Every other jobs column: what an applicant may read about a job they applied to (the listing, its schedule and the
 * pay inputs the take-home figure needs). FAIL CLOSED: a new jobs column turns the exact-set check red until it is
 * classified here or in PRIVATE.
 */
const APPLICANT_VISIBLE = [
  "accepted_at", "boost_auto_extended", "boost_expires_at", "boosted_at", "budget", "business_id", "cancellation_fee",
  "cancelled_at", "category", "commission_tax_amount", "completed_at", "created_at", "credential_tier",
  "customer_fee_amount", "customer_id", "date_needed", "date_window_end", "dayof_confirm_reminder_sent_at",
  "dayof_unanswered_poster_alert_sent_at", "department", "description", "direct_offer_expires_at",
  "direct_offer_status", "dispute_deadline", "estimated_hours", "expires_at", "expiring_final_notif_sent",
  "expiring_notif_sent", "helper_arrival_verified_at", "helper_arrived_at", "helper_completed_at",
  "helper_confirmed_at", "helper_dayof_confirmed_at", "helper_fee_flat_cents", "helper_fee_percent", "helper_id",
  "helper_on_the_way_at", "helpers_needed", "id", "instant_booked_at", "instant_decline_until", "is_auto_created",
  "is_flexible_schedule", "is_group_job", "is_recurring", "is_seed", "is_urgent", "last_edit_notice_at",
  "late_cancellation", "materials_note", "no_show_alert_sent_at", "onboarding_fee_amount", "parent_job_id", "parish",
  "payment_confirm_notif_sent", "payment_status", "photos", "platform_fee_amount", "platform_fee_percent",
  "poster_completed_at", "poster_confirmed_arrival_at", "poster_confirmed_at", "poster_confirmed_working_at",
  "poster_fee_flat_cents", "poster_marked_done_at", "pricing_mode", "protection_fee", "recurrence_days",
  "recurrence_end_date", "recurrence_interval", "recurrence_weeks", "recurring_helper_id",
  "release_last_chance_notif_sent_at", "removed_at", "require_photo_proof", "requires_w9", "response_deadline",
  "review_reminder_sent", "revision_acceptance_deadline", "revision_completed_at", "revision_count",
  "revision_deadline", "revision_requested_at", "sales_tax_amount", "sales_tax_rate", "scope_video_url",
  "series_ban_cancelled_at", "series_ended_on", "series_split_ok", "special_requirements", "start_reminder_sent_at",
  "start_time", "status", "tax_kind", "title", "updated_at", "urgent_fee", "zip_code",
];

/** jobs' columns as the generated types know them (src/integrations/supabase/types.ts, equal to prod's 126 on 11-05). */
function jobsColumns(): string[] {
  const types = readFileSync(resolve(__dirname, "../integrations/supabase/types.ts"), "utf8");
  const at = types.indexOf("      jobs: {\n        Row: {");
  expect(at, "types.ts has the jobs Row").toBeGreaterThan(-1);
  const end = types.indexOf("\n        }", at + 30);
  return [...types.slice(at, end).matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

/**
 * Definers whose every row a plain SELECT on jobs already shows the caller, with the policy that does it.
 * get_my_pending_direct_offers: only rows WHERE offered_to_helper_id = caller AND direct_offer_status = 'pending', the
 * "Targeted helper can view direct offer" policy (read on prod 2026-11-05). 20261105102419 aligned the definer's WHERE
 * with that policy (status open, no helper yet; the PGlite proof's D2).
 */
const ROW_VISIBLE_BY_RLS: Record<string, string> = {
  get_my_pending_direct_offers: "Targeted helper can view direct offer",
};

const setofJobsDefiners = [...EFFECTIVE.entries()]
  .filter(([, d]) => {
    const s = blankSqlComments(d.stmt);
    return /RETURNS\s+SETOF\s+(public\.)?jobs\b/i.test(s) && /\bSECURITY\s+DEFINER\b/i.test(s);
  })
  .map(([name]) => name)
  .sort();

describe("every SECURITY DEFINER returning SETOF jobs hides the private columns from a caller who is not a party", () => {
  it("finds the definers (the inventory is not empty)", () => {
    // Measured 2026-11-05: get_jobs_for_my_applications and get_my_pending_direct_offers (prod pg_proc agrees).
    expect(setofJobsDefiners.length).toBeGreaterThanOrEqual(2);
    expect(setofJobsDefiners).toContain("get_jobs_for_my_applications");
  });

  it.each(setofJobsDefiners)("%s overrides every private column, or RLS already shows the whole row", (name) => {
    if (name in ROW_VISIBLE_BY_RLS) return;
    const s = blankSqlComments(EFFECTIVE.get(name)!.stmt);
    expect(s, `${name}: no party test before the override`).toMatch(/CASE\s+WHEN\s+e\.ok\s+OR\s+j\.customer_id\s*=\s*v_uid\s+OR\s+j\.helper_id\s*=\s*v_uid\s+THEN\s+'\{\}'::jsonb\s+ELSE\s+jsonb_build_object\(/i);
    const override = s.slice(s.search(/THEN\s+'\{\}'::jsonb\s+ELSE\s+jsonb_build_object\(/i));
    for (const col of PRIVATE) expect(override, `${name} hides ${col}`).toContain(`'${col}'`);
  });

  it("every jobs column is classified exactly once (fails closed on a new column)", () => {
    const cols = jobsColumns();
    expect(cols.length).toBeGreaterThanOrEqual(120);
    const classified = [...PRIVATE, ...MASKED, ...APPLICANT_VISIBLE];
    expect(new Set(classified).size, "a column is classified twice").toBe(classified.length);
    expect([...classified].sort()).toEqual(cols);
  });

  it("ROW_VISIBLE_BY_RLS names only definers that exist (exact both ways)", () => {
    for (const name of Object.keys(ROW_VISIBLE_BY_RLS)) expect(setofJobsDefiners, name).toContain(name);
  });
});
