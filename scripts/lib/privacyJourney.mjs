/**
 * The monthly privacy-requests journey's safety rails and expectations
 * (docs/OPEN.md Q70; e2e/privacy/privacy-requests.spec.ts,
 * .github/workflows/privacy-journey.yml).
 *
 * The journey creates ONE disposable account, exports its data through the
 * real "Download My Data" button, deletes it through the real "Delete account"
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
  // Q1791: the Sign in with Apple revoke reports on every run ("no_token" for an account with no Apple token, as the journey's).
  "apple_revoke",
  "declutter_scrub",
  "database",
  "job_media",
  "message_attachments",
  // LEAD-LIST-FOR-SELLER: plans the listing photos a Helpr uploaded for a seller (reports on every run).
  "listed_for_seller_photos",
];

/** Steps that appear only when the purge REFUSES (a malformed user id): absent on a good run. */
export const CONDITIONAL_PURGE_STEPS = ["input"];

/** purgeBuckets.ts IDENTITY_BUCKETS (the ones accountPurge.ts erases): every one is listed at <uid>/ after deletion and must be empty. */
export const IDENTITY_BUCKETS = ["avatars", "user-documents", "application-attachments"];

/**
 * Top-level sections of the "Download My Data" JSON: the keys export_my_data()
 * returns (newest definition: supabase/migrations/20261004162921_payout_holds_server_side.sql) plus the
 * `storage_objects` the export-my-data edge function adds. Kept equal to them by
 * src/test/dataExportCoversEveryUserTable.test.ts.
 */
export const EXPORT_SECTIONS = [
  "exported_at", "user_id", "email", "profile", "jobs", "applications", "reviews", "messages",
  "message_reactions", "notifications", "notification_preferences", "notification_logs",
  "notification_dedupe_suppressions", "push_tokens",
  // Web push (20261030022344): browser subscriptions, without endpoint / p256dh / auth.
  "push_subscriptions",
  "saved_jobs", "saved_searches",
  "saved_search_alert_queue", "match_digest_queue", "parish_match_alert_queue",
  "favorite_helpers", "helper_availability",
  "helper_credentials", "helper_verifications", "verification_checks",
  "helper_w9_records", "instant_payouts", "payout_transfers", "crew_cancellation_fee_shares", "crew_block_fees", "cancellation_fee_transfers",
  "payment_refunds",
  "chargeback_clawbacks", "tips", "tip_hold_redrives", "gift_cards", "referral_codes", "referral_credits", "referrals",
  "reports", "user_blocks", "user_bans", "user_violations", "user_roles",
  "legal_acceptances", "login_history", "email_tracking", "email_send_log", "suppressed_emails",
  "job_checkins", "job_tracking", "group_job_helpers", "recurring_visit_releases", "recurring_visit_payments", "job_revisions",
  "job_completion_nudges", "job_match_queue", "disputes", "job_views", "profile_views", "pet_profiles",
  "str_calendar_connections", "thread_archives", "thread_mutes", "thread_pins", "nps_responses",
  "analytics_events", "payout_holds",
  "application_rate_log", "profile_search_rate_log", "job_pets", "job_access_notes",
  "crew_dispute_member_outcomes", "job_schedule_change_requests", "job_detail_change_requests", "job_detail_change_answers",
  "series_date_offers", "series_visit_holds",
  "declutter_items", "declutter_item_private", "declutter_item_photos", "declutter_pickup_windows",
  // Remembered listing choices (20261030144112; exported by 20261030153635).
  "declutter_seller_defaults",
  // A half-finished job post kept on the account (20261030223154, OPS-3).
  "job_post_drafts",
  "member_signup_sources",
  "profile_handles_retired",
  "instant_book_floors",
  "instant_book_declines",
  // Porch days (20261029161347; exported by 20261029223949).
  "declutter_seller_porch_days",
  // A seller's own meet spots (20261101194608; exported by 20261101210500).
  "declutter_meetup_spots",
  "declutter_porch_places",
  "declutter_porch_place_choices",
  "declutter_order_porch_places",
  "declutter_questions", "declutter_watchlist", "declutter_tax_attestations", "declutter_strikes",
  "category_suggestions",
  "declutter_offers", "declutter_orders", "declutter_cart_items", "declutter_buyer_cards",
  "declutter_seller_fee_debts",
  "declutter_bookings", "declutter_problems", "declutter_problems_about_me", "declutter_refund_requests", "declutter_payouts", "declutter_reviews",
  "declutter_wanted",
  "helpr_vehicles", "helpr_tasks", "helpr_task_events", "helpr_task_payouts", "helpr_task_tips", "declutter_delivery_dropoffs",
  "declutter_seller_delivery", "declutter_delivery_windows", "declutter_delivery_days_off", "declutter_item_no_seller_delivery", "declutter_seller_deliveries",
  "job_guarantee_claims",
  "declutter_meetup_choices", "declutter_order_meetups",
  "declutter_bundle_rules",
  "declutter_handover_talks", "declutter_handover_talk_messages",
  // The paid-order chat (20261030004216, exported by 20261030024748).
  "declutter_order_talks", "declutter_order_talk_messages", "helpr_task_talk_messages",
  // The Free change (20261030064021, Q2487): asks for free items and the 30-day pause.
  "declutter_free_requests", "declutter_free_pauses",
  // Quotes (20261015091114, exported by 20261030081455, Q1866).
  "job_quote_requests", "job_quotes", "job_quotes_on_my_requests", "job_quote_offers",
  "shops", "shop_photos", "shop_follows", "shop_items", "shop_item_private", "shop_item_photos",
  "shop_item_attestations", "shop_cottage_confirmations", "shop_cottage_sales",
  "rental_properties", "rental_units", "rental_tenancies", "maintenance_requests", "maintenance_request_photos",
  // Homes listings (20261019043000, exported by 20261019043100).
  "rental_listings", "rental_listing_photos",
  "shop_orders", "shop_order_lines", "shop_strikes", "shop_pickup_addresses",
  // Q2082 (b): the Helpr's own Helpr-fault rulings (20261019015302).
  "helpr_fault_rulings",
  // Landlord ID (owner 2026-10-19): the member's own ID review (status, dates, note).
  "landlord_id_reviews",
  // Homes rent + deposit records (20261019073106, 20261019082216; exported by 20261019083350).
  "rental_rent_plans", "rental_rent_charges", "rental_rent_payments", "rental_deposits", "rental_leases",
  // Saved homes (20261019185722; exported by 20261019185723).
  "saved_homes",
  // Board 143a (20261021035753): the member's own bank payout failures.
  "payout_failures",
  // Board 141 (20261021184925): refund requests the member asked, was asked or answered.
  "refund_requests",
  // SMS alerts (20261021193738): text consent, its events, and texts considered.
  "sms_consent", "sms_consent_events", "sms_messages",
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
