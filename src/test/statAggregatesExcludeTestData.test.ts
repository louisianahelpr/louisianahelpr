/**
 * Test data never counts in any number (owner rule via lead 2026-10-29, builder 62).
 *
 * Inventory: every SECURITY DEFINER function the migrations leave in the database (effectiveDefs:
 * the newest definition after rewrites, any dollar-quote tag, comments blanked) that is not a
 * trigger and computes a count(), sum() or avg(). Each one must either reference the test-data
 * exclusion (`is_seed` or `public.is_test_member(`) or be listed below with the reason its
 * aggregate is logic rather than a number a person reads (a rate limit, fee or refund arithmetic,
 * crew spot arithmetic, a strike ladder, an ops monitor, input validation). The list is exact both
 * ways: a function that gains the exclusion, or disappears, must leave it.
 *
 * Granularity: the check is per FUNCTION, not per aggregate expression. A function that excludes
 * test data in one aggregate and not in another passes; REQUIRED_HELPER pins the functions restated
 * by 20261030015205 to the helper itself, so get_public_profile_stats (which already said is_seed
 * in its visibility gate) cannot pass on that alone.
 *
 * PGlite proof of the behaviour: src/test/pglite/testDataNeverCounts.pglite.mjs (26 checks; 25 go
 * red with the exclusion mutated away).
 *
 * @mutate supabase/migrations/20261030015205_test_data_never_counts.sql | AND NOT public.is_test_member(jv.viewer_id) | AND true
 * @mutate supabase/migrations/20261030015205_test_data_never_counts.sql |              AND NOT public.is_test_member(q.user_id)); |              );
 * @mutate src/hooks/useProfileTabData.ts | .eq("customer_id", id).eq("is_seed", false), | .eq("customer_id", id),
 * @mutate supabase/functions/weekly-helper-report/index.ts | .eq("jobs.is_seed", false)\n          .gte("created_at", weekAgoISO), | .gte("created_at", weekAgoISO),
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

const LIMIT = "logic: a rate limit or cap on the caller's own actions, not a number anyone reads";
const MONEY = "logic: fee, refund or payout arithmetic, which must count every real row it settles";
const SPOTS = "logic: crew roster / spot arithmetic on one job";
const LADDER = "logic: a strike or violation ladder for one member";
const OPS = "ops: an internal health monitor or sweep, never shown to a member";
const VALID = "logic: validates the caller's input (photo count, ownership, size)";
const PURGE = "logic: counts the rows a purge or expiry just touched";

/**
 * Not yet decided: these return a number a person may read and do not exclude test data. Exact
 * ratchet; each one is cleared by adding the exclusion (and removing it here). Tracked by the
 * OPEN item filed with this guard (b62 phase 2).
 */
const REVIEW = "REVIEW: a displayed number that still counts test data (b62 phase 2)";

// @two-way src/test/statAggregatesExcludeTestData.test.ts:Object.keys(ALLOWED).filter((n) => !inventory.has(n)
const ALLOWED: Record<string, string> = {
  accept_group_application: SPOTS,
  admin_reverse_violation: LADDER,
  apply_cancellation_violation_consequence: LADDER,
  apply_job_denial_consequence: LADDER,
  apply_low_rating_flag: LADDER,
  apply_to_job: LIMIT,
  // LEAD-LIST-FOR-SELLER: counts one listing's own photos for the Helpr writing it (a draft's photo count), not a stat.
  declutter_helpr_job_listings: "counts one listing's own photos for the Helpr writing it, not a stat over members",
  block_user_and_settle: SPOTS,
  can_send_message_to_in_job: LIMIT,
  check_db_saturation: OPS,
  check_dispute_velocity: LIMIT,
  check_error_log_throttle: OPS,
  check_ops_alert_pending: OPS,
  check_ops_digest_delivery: OPS,
  check_seed_boundary_failures: OPS,
  check_user_reports_reach_ledger: OPS,
  crew_closed_spot_count: SPOTS,
  crew_spots_open: SPOTS,
  cron_dispatch_health: OPS,
  cron_silent_still_failing: OPS,
  declutter_active_strike_count: LADDER,
  declutter_bundle_preview: MONEY,
  declutter_bundle_targets: MONEY,
  declutter_cancel_haul_away: VALID,
  declutter_checkout_free: MONEY,
  declutter_consume_fee_debt: MONEY,
  declutter_create_move_drafts: LIMIT,
  declutter_create_wanted: LIMIT,
  // DC-8 (20261030061927): the last photo of a listing on sale stays (counts the item's own photos).
  declutter_remove_item_photo: VALID,
  declutter_delivery_slot_used: LIMIT,
  declutter_donation_own_items: VALID,
  declutter_donation_partner_miles: VALID,
  declutter_hand_refund_failed: MONEY,
  declutter_link_haul_away: VALID,
  declutter_make_offer: LIMIT,
  declutter_mark_order_paid: MONEY,
  declutter_notice_names_item: "logic: names the first item of one order in its notice (\"and N more\")",
  declutter_order_refunds_recorded_cents: MONEY,
  declutter_reopen_wanted: "logic: counts the caller's own open wanted posts for the limit of 10, the same whether or not they are a test account",
  declutter_pickup_reminder_sweep: "logic: names the first item of one order in its reminder (\"and N more\")",
  declutter_publish_item: VALID,
  declutter_record_hand_refund: MONEY,
  declutter_seller_delivery_check: MONEY,
  declutter_seller_hidden_sweep: OPS,
  declutter_send_handover_message: LIMIT,
  declutter_send_order_message: LIMIT,
  declutter_set_pickup_windows: VALID,
  declutter_start_checkout: MONEY,
  declutter_wanted_record_match: LIMIT,
  deliver_job_match: LIMIT,
  deliver_parish_match_alert: LIMIT,
  detect_suspicious_user_patterns: REVIEW,
  end_recurring_series: "logic: visits still booked on the one series being ended",
  expire_pending_direct_offers: PURGE,
  export_my_data: "logic: the review-visibility rule inside the caller's own data export",
  get_helper_earnings_export: REVIEW,
  get_my_quote_requests: REVIEW,
  get_my_reply_latency: REVIEW,
  get_my_saved_helpers: REVIEW,
  get_parish_for_city: VALID,
  get_payout_batches: REVIEW,
  helper_cancel_booking: SPOTS,
  helpr_route_suggestions: LIMIT,
  helpr_task_accept: LIMIT,
  helpr_task_give_job_strike: LADDER,
  helpr_task_send_message: LIMIT, // BUY-36 delivery chat (20261031231948): 30 of the sender's own messages an hour
  // B-delivery (20261030044539): open-task counts by area for a Helpr; helpr_task_same_stripe_mode keeps a seeded test
  // account's tasks and a real member's apart, so a real Helpr never counts test data.
  helpr_tasks_open_count: "excludes test data: helpr_task_same_stripe_mode (seeded test accounts and real members never see one another's tasks)",
  job_photos_shareable: VALID,
  log_cron_defect: OPS,
  marketing_published_today: REVIEW,
  message_violation_ladder: LADDER,
  notification_admin_full_names: VALID,
  offer_series_dates: LIMIT,
  open_dispute_as: LIMIT,
  ops_alert_record_user_error_screen: OPS,
  ops_alert_record_user_report: OPS,
  ops_alert_verify: OPS,
  poster_cancel_job: MONEY,
  poster_crew_block_fee_cents: MONEY,
  prune_cron_http_requests: PURGE,
  purge_user_data: PURGE,
  rate_limit_hit: LIMIT,
  rentals_add_rent_payment: MONEY,
  rentals_add_unit: LIMIT,
  rentals_create_property: LIMIT,
  rentals_file_request: LIMIT,
  rentals_invite_tenant: LIMIT,
  rentals_lease_save: VALID,
  rentals_remove_listing_photo: VALID,
  rentals_rent_ledger: MONEY,
  rentals_rent_sweep: MONEY,
  rentals_set_listing_status: VALID,
  rentals_set_saved_home: LIMIT,
  report_helper_no_show: LADDER,
  respond_job_detail_change: "logic: pending changes on the one job being answered",
  restore_gift_card_for_job: MONEY,
  revoke_gift_card_for_refund: MONEY,
  rpc_add_dispute_evidence: VALID,
  rpc_check_application_rate: LIMIT,
  rpc_decide_crew_dispute: MONEY,
  rpc_group_member_mark_done: SPOTS,
  rpc_open_dispute: LIMIT,
  rpc_open_refund_request: LIMIT,
  run_missed_cron_catch_up: OPS,
  send_ops_daily_digest: OPS,
  settle_job_detail_change: "logic: pending changes on the one job being settled",
  shop_active_strike_count: LADDER,
  shop_cottage_sales_cents: "logic: Louisiana cottage-food yearly sales cap for one shop",
  shop_day_count: LIMIT,
  shop_record_hand_refund: MONEY,
  shops_accept_order: MONEY,
  shops_create_item: LIMIT,
  shops_get_shop: REVIEW,
  shops_order_terms: LIMIT,
  shops_publish_item: VALID,
  sms_dispatch_due: OPS,
  sms_inbound_keyword: LIMIT,
  sms_phone_prompt_due: "logic: asks for a phone only after the caller's own first job",
  start_underfilled_crews: SPOTS,
  submit_job_quote: LIMIT,
  suggest_category: LIMIT,
  declutter_on_my_way: "logic: the \"and N more\" count of one order's own lines in one notice",
  sweep_cron_startup_failures: OPS,
  sweep_dayof_confirm_reminders: SPOTS,
  sweep_dead_crons: OPS,
  sweep_no_show_alerts: SPOTS,
  sweep_quote_alerts: OPS,
  sweep_silent_cron_failures: OPS,
  sweep_unfilled_series_visit_reminders: PURGE,
  take_helpr_fault_fee: MONEY,
};

/** Restated by 20261030015205: must call the helper itself (is_seed alone is not enough). */
const REQUIRED_HELPER = [
  "get_helper_completed_counts", "get_helper_on_time_percents", "get_helper_repeat_hire_percents",
  "get_user_repeat_hire_percent", "get_helper_tiers", "get_job_view_counts", "get_neighbor_hire_count",
  "get_applicant_category_counts", "get_job_match_reach", "admin_sms_status", "admin_list_category_suggestions",
  "rentals_admin_listings", "get_public_profile_stats",
];
/** Restated by the b62 migration (20261030015205): a table-specific test marker instead of the helper. */
const REQUIRED_SEED = { admin_list_signup_leads: /is_seed_email\s*\(/i, shops_admin_pending_items: /\bis_seed\s+IS\s+NOT\s+TRUE/i };

const AGG = /\b(count|sum|avg)\s*\(/i;
const EXCLUDES = /\bis_seed\b|is_seed_email\s*\(|\bis_test_member\s*\(/i;

const defs = effectiveDefs(MIGRATIONS);
const inventory = new Map<string, string>();
for (const [name, d] of defs) {
  const code = blankSqlComments(d.stmt);
  if (!/security\s+definer/i.test(code) || /returns\s+trigger/i.test(code) || !AGG.test(code)) continue;
  inventory.set(name, code);
}

describe("every aggregate in a definer function excludes test data or says why not", () => {
  it("inventory is real (floor)", () => {
    expect(inventory.size).toBeGreaterThan(150);
  });

  it("each aggregating function excludes test data or carries an allowlisted reason", () => {
    const bare = [...inventory].filter(([n, code]) => !EXCLUDES.test(code) && !(n in ALLOWED)).map(([n]) => n);
    expect(bare, "add the is_seed / is_test_member exclusion, or a reason in ALLOWED").toEqual([]);
  });

  it("the allowlist is exact: no function that excludes test data, or no longer exists, stays listed", () => {
    const stale = Object.keys(ALLOWED).filter((n) => !inventory.has(n) || EXCLUDES.test(inventory.get(n)!));
    expect(stale).toEqual([]);
  });

  it("the not-yet-decided list is an exact ratchet (b62 phase 2)", () => {
    expect(Object.values(ALLOWED).filter((r) => r === REVIEW).length).toBe(8);
  });

  it("the functions restated by 20261030015205 call is_test_member", () => {
    const missing = REQUIRED_HELPER.filter((n) => !/\bis_test_member\s*\(/i.test(inventory.get(n) ?? ""));
    expect(missing).toEqual([]);
    for (const [n, re] of Object.entries(REQUIRED_SEED)) expect(re.test(inventory.get(n) ?? ""), n).toBe(true);
  });

  it("is_test_member reads both test markers (profiles.is_seed and test_accounts)", () => {
    const sql = blankSqlComments(defs.get("is_test_member")?.stmt ?? "");
    expect(sql).toMatch(/is_seed IS TRUE/);
    expect(sql).toMatch(/test_accounts/);
  });
});

describe("client-side job totals a member reads drop test jobs", () => {
  // Own-profile tiles (useProfileStats): completed-as-Helpr and posted totals. Signed-in only, so
  // the jobs.is_seed column filter is allowed (authenticated has SELECT on it; anon does not).
  it("useProfileTabData's two jobs totals filter is_seed", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../hooks/useProfileTabData.ts"), "utf8"));
    const counts = code.split("\n").filter((l) => /from\("jobs"\)/.test(l) && /count: "exact"/.test(l));
    expect(counts.length).toBe(2);
    for (const l of counts) expect(l).toContain('.eq("is_seed", false)');
  });
});

describe("the weekly Helpr report email counts no test data", () => {
  // The four reads each carry the exclusion (the header @mutate drops the applications one).
  it("jobs, earnings, reviews and applications all filter jobs.is_seed", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/weekly-helper-report/index.ts"), "utf8"));
    const i = code.indexOf("const [jobsRes, reviewsRes, earningsRes, appsRes] = await Promise.all([");
    expect(i).toBeGreaterThan(0);
    const block = code.slice(i, code.indexOf("]);", i));
    expect(block.match(/\.eq\("is_seed", false\)/g)?.length).toBe(2);
    expect(block.match(/\.eq\("jobs\.is_seed", false\)/g)?.length).toBe(2);
  });
});
