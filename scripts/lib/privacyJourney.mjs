/**
 * The monthly privacy-requests journey's safety rails and expectations
 * (docs/OPEN.md Q70; e2e/privacy/privacy-requests.spec.ts,
 * .github/workflows/privacy-journey.yml).
 *
 * The journey creates ONE disposable account, exports its data through the
 * real "Download My Data" button, deletes it through the real "Delete Account"
 * dialog and then checks, row by row and object by object, what the purge
 * did. Deleting an account on the only database there is (prod) must never
 * be able to reach a real person, so everything destructive goes through
 * assertDisposable(), which FAILS CLOSED: it throws unless every one of these
 * holds, read fresh from the database by the caller:
 *   - the email matches DISPOSABLE_EMAIL_RE (a per-run mailinator address this
 *     journey mints; nobody else uses the prefix) and the run tag in it is
 *     THIS run's;
 *   - the email is not one of the SHARED test accounts (those are never
 *     deleted either: every other suite signs in as them);
 *   - profiles.is_seed is true;
 *   - the auth user was created by this run (after runStartedAt - 5 min).
 */

/** Per-run disposable address. The tag is [a-z0-9]{8,16}. */
export const DISPOSABLE_EMAIL_RE = /^helpr-privacy-journey-([a-z0-9]{8,16})@mailinator\.com$/;

export function disposableEmail(runTag) {
  const email = `helpr-privacy-journey-${runTag}@mailinator.com`;
  if (!DISPOSABLE_EMAIL_RE.test(email)) throw new Error(`bad run tag ${JSON.stringify(runTag)}`);
  return email;
}

/** Accounts other suites sign in as. Never a deletion target, whatever they look like. */
export const SHARED_TEST_EMAILS = [
  "helpr-e2e-poster-0902@mailinator.com",
  "helpr-e2e-helper-0902@mailinator.com",
  "eli.test.helper@louisianahelpr.com",
  "helpr-audit-web-0824@mailinator.com",
];

/**
 * Throws unless `subject` is this run's disposable seed account.
 * @param {{ runTag: string, runStartedAt: number, email?: string|null,
 *           isSeed?: boolean|null, authCreatedAt?: string|null }} subject
 */
export function assertDisposable(subject) {
  const email = String(subject?.email ?? "").toLowerCase();
  const m = DISPOSABLE_EMAIL_RE.exec(email);
  if (!m) throw new Error(`REFUSED: ${email || "(no email)"} is not a privacy-journey disposable address`);
  if (m[1] !== subject.runTag) throw new Error(`REFUSED: ${email} belongs to another run (tag ${m[1]}, this run ${subject.runTag})`);
  if (SHARED_TEST_EMAILS.includes(email)) throw new Error(`REFUSED: ${email} is a shared test account`);
  if (subject.isSeed !== true) throw new Error(`REFUSED: ${email} is not profiles.is_seed = true`);
  const created = Date.parse(String(subject.authCreatedAt ?? ""));
  if (!Number.isFinite(created) || !Number.isFinite(subject.runStartedAt) || created < subject.runStartedAt - 5 * 60_000)
    throw new Error(`REFUSED: ${email} was not created by this run (${subject.authCreatedAt ?? "unknown"})`);
  return true;
}

/**
 * Steps delete-own-account reports back (supabase/functions/_shared/accountPurge.ts,
 * `steps.push({ step: ... })`). Every one must come back ok:true; the journey
 * asserts EACH by name. Exact both ways: src/test/privacyJourneyCoversPurge.test.ts
 * fails when accountPurge.ts gains or loses a step name.
 */
export const EXPECTED_PURGE_STEPS = [
  "input",
  "stripe",
  "storage",
  "avatar_pointer",
  "retain_ban",
  "database",
  "job_media",
  "message_attachments",
];

/** Steps that appear only when the purge REFUSES (a malformed user id): absent on a good run. */
export const CONDITIONAL_PURGE_STEPS = ["input"];

/** purgeBuckets.ts IDENTITY_BUCKETS (the ones accountPurge.ts erases): every one is listed at <uid>/ after deletion and must be empty. */
export const IDENTITY_BUCKETS = ["avatars", "user-documents", "application-attachments"];

/**
 * Top-level sections of the "Download My Data" JSON: the keys export_my_data()
 * returns (newest definition: supabase/migrations/20260926045122_export_my_data_email_rows_other_accounts.sql) plus the
 * `storage_objects` the export-my-data edge function adds. Kept equal to them by
 * src/test/dataExportCoversEveryUserTable.test.ts.
 */
export const EXPORT_SECTIONS = [
  "exported_at", "user_id", "email", "profile", "jobs", "applications", "reviews", "messages",
  "message_reactions", "notifications", "notification_preferences", "notification_logs",
  "notification_dedupe_suppressions", "push_tokens", "saved_jobs", "saved_searches",
  "saved_search_alert_queue", "match_digest_queue", "favorite_helpers", "helper_availability",
  "helper_credentials", "helper_verifications", "verification_checks", "verification_exceptions",
  "helper_w9_records", "instant_payouts", "payout_transfers", "crew_cancellation_fee_shares", "payment_refunds",
  "chargeback_clawbacks", "tips", "gift_cards", "referral_codes", "referral_credits", "referrals",
  "reports", "user_blocks", "user_bans", "user_strikes", "user_violations", "user_roles",
  "legal_acceptances", "login_history", "email_tracking", "email_send_log", "suppressed_emails",
  "job_checkins", "job_tracking", "group_job_helpers", "recurring_visit_releases", "job_revisions",
  "job_completion_nudges", "disputes", "job_views", "profile_views", "pet_profiles",
  "str_calendar_connections", "thread_archives", "thread_mutes", "thread_pins", "nps_responses",
  "analytics_events", "error_logs", "admin_user_notes", "fraud_flags", "helper_shadowbans",
  "application_rate_log", "profile_search_rate_log",
  "storage_objects",
];

/**
 * Tables the journey seeds rows into that the export does NOT contain today.
 * EXACT: the journey fails if one of these starts appearing in the export
 * (shrink the list) or if another seeded table is missing (a regression).
 * Empty since Q290 (export_my_data covers every user-keyed table).
 */
// @two-way src/test/privacyJourneyCoversPurge.test.ts:is exported now: shrink KNOWN_NOT_EXPORTED
export const KNOWN_NOT_EXPORTED = [];

/**
 * purge_user_data() counters (the `database` step's detail JSON) the journey's
 * own seed rows must move, with the minimum each must reach.
 */
export const EXPECTED_DB_COUNTS = {
  jobs_deleted: 1,
  jobs_redacted: 1,
  notification_preferences_deleted: 1,
  profile_redacted: 1,
  reports_anonymised: 1,
};
