/**
 * Class guard: every rule that reads `is_seed` is classified, and every one
 * that lets money move or skips a money/payout/ID requirement needs a real
 * test-account ENROLMENT (public.test_accounts), never is_seed alone
 * (docs/OPEN.md Q2244; Oct 2026 money audit, finding 8).
 *
 * WHY: until 20261025161836, trg_profiles_seed_from_fixture_email made any
 * sign-up with a fixture-looking email (@mailinator.com, @helpr.test,
 * eli.test.*) is_seed = true, so a stranger could make their account "test"
 * and pass helper_award_block_reason's seed exemption (the payout-setup gate on
 * awarding a job). That trigger is gone (src/test/fixtureWritersSetIsSeed.test.ts
 * keeps any profiles INSERT trigger from deriving is_seed again), and the
 * client can never set it (prevent_self_escalation pins it, asserted below).
 *
 * WHAT IT CHECKS
 *   SQL  every function the migrations leave defined (effectiveDefs: newest
 *        definition, any dollar-quote tag, comments blanked) whose body reads
 *        is_seed is in SQL_CARVE_OUTS, EXACT both ways. A "money-gate" body
 *        must also read public.test_accounts.
 *   EDGE every supabase/functions file that reads is_seed is in EDGE_READERS,
 *        EXACT both ways; a "money-gate" file must also read test_accounts.
 * A new rule that reads is_seed fails here until someone decides which kind it
 * is. Categories:
 *   money-gate   is_seed would let money move or skip a money/payout/ID check:
 *                MUST read test_accounts.
 *   hides        a seed row is shown to fewer people, kept out of stats,
 *                matching, notifications or discovery (fails safe).
 *   tags         copies the flag onto a row it writes, or labels a log row.
 *   alerts       a seed row's alert is routed lower / never pages.
 *   safety-skip  a seed account skips a non-money rule (phone reuse, ban-
 *                evasion doubt-check, short notice, LA address, arrival
 *                window); safe only because is_seed is not self-grantable.
 *   locks        pins or derives the column itself.
 *   cleanup      the seed purge (money rows are listed, never deleted).
 *
 * RED ON THE ORIGINAL: at origin/main 8ca225a0e3 helper_award_block_reason is
 * a money-gate whose newest body (20261001222911) never reads test_accounts.
 *
 * @mutate supabase/migrations/20261025161836_seed_flag_not_self_grantable.sql |   IF v_seed IS TRUE AND v_acct IS NULL\n     AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN | IF v_seed IS TRUE AND v_acct IS NULL THEN
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

type Kind = "money-gate" | "hides" | "tags" | "alerts" | "safety-skip" | "locks" | "cleanup";

/** Every SQL function whose newest body reads is_seed. EXACT both ways. */
// @two-way src/test/isSeedCarveOutsNeedEnrolment.test.ts:toEqual(Object.keys(SQL_CARVE_OUTS).sort())
const SQL_CARVE_OUTS: Record<string, Kind> = {
  admin_queue_still_pending: "hides",
  admin_rule_helpr_fault: "tags",
  admin_section_funnel: "hides",
  check_push_token_health: "alerts",
  claim_come_back_emails: "hides",
  // confirm-your-email reminders (20261025190000): a seed account gets no reminder email
  claim_confirm_reminders: "hides",
  // payout setup after the hire (20261025162003): an enrolled seed Helpr with no payout account gets no reminder
  claim_payout_setup_reminders: "hides",
  complete_pending_accepts_on_setup: "alerts",
  create_quote_request: "tags",
  declutter_apply_seller_fault: "alerts",
  declutter_ask_question: "hides",
  declutter_claim_free: "hides",
  declutter_delivery_dropoffs_seed: "tags",
  declutter_delivery_on_task_event: "tags",
  declutter_delivery_open_task: "tags",
  declutter_haul_away_job_refunded: "alerts",
  declutter_items_seed_from_seller: "tags",
  declutter_lock_buyable_item: "hides",
  declutter_money_rows_seed: "tags",
  declutter_notify: "hides",
  declutter_order_rows_seed: "tags",
  declutter_price_drop_alert: "hides",
  declutter_price_drop_sweep: "hides",
  declutter_price_hint: "hides",
  declutter_refund_cancels_setup_jobs: "alerts",
  declutter_refund_gave_up_check: "alerts",
  // board 141d (20261026155251): a refund request follows its order's is_seed
  declutter_refund_requests_seed: "tags",
  declutter_seller_delivery_seed: "tags",
  declutter_seller_moving_sale: "hides",
  declutter_set_watch: "hides",
  // Q2352 (20261026154738): an ENROLLED test account (is_seed AND test_accounts) lists without the setup fee
  declutter_setup_fee_before_list: "money-gate",
  declutter_setup_job_fee_debt: "alerts",
  declutter_take_item: "hides",
  declutter_trade_rows_seed: "tags",
  declutter_visible_reviews: "hides",
  declutter_wanted_browse: "hides",
  declutter_wanted_pairs: "hides",
  declutter_wanted_reply: "hides",
  declutter_wanted_seed_from_poster: "tags",
  deliver_saved_search_alert: "hides",
  deliver_saved_search_item_alerts: "hides",
  detail_change_address_in_louisiana: "safety-skip",
  detect_stuck_payments: "alerts",
  direct_accept_block_reason: "hides",
  end_series_for_banned_account: "alerts",
  enforce_application_job_state: "hides",
  enforce_jobs_insert_column_lock: "locks",
  enforce_poster_jobs_money_lock: "locks",
  enforce_retained_ban: "safety-skip",
  enqueue_instant_job_match: "alerts",
  expire_unanswered_offers: "alerts",
  facilitated_la_sales_cents: "hides",
  flag_possible_ban_evasion_by_phone: "safety-skip",
  get_category_price_stats: "hides",
  get_fill_rate_stats: "hides",
  get_helper_analytics: "hides",
  get_open_jobs_for_map: "hides",
  get_parish_activity: "hides",
  get_price_guidance: "hides",
  get_public_open_jobs: "hides",
  get_public_profile_reviews: "hides",
  get_public_profile_stats: "hides",
  get_ranked_open_jobs: "hides",
  get_safe_profiles: "hides",
  guard_profile_phone: "safety-skip",
  // The ID/payout step at accept: an enrolled, fixture-shaped account only (20261020043346).
  helper_accept_missing: "money-gate",
  // The payout-setup gate on awarding a job (Q2244, 20261025161836).
  helper_award_block_reason: "money-gate",
  helpr_task_create: "tags",
  helpr_task_rows_seed: "tags",
  // Delivery tasks pay only between parties of one Stripe mode.
  helpr_task_same_stripe_mode: "money-gate",
  helpr_vehicles_seed: "tags",
  // The ID check is skipped for an enrolled test account.
  identity_check_exempt: "money-gate",
  is_seed_email: "alerts",
  job_announceable_to: "hides",
  job_posted_by_seed: "safety-skip",
  jobs_address_in_louisiana: "safety-skip",
  jobs_seed_from_poster: "tags",
  list_open_quote_requests: "hides",
  log_deleted_job: "tags",
  notification_crosses_seed_boundary: "hides",
  notify_admins_new_member: "hides",
  notify_helpers_on_job_post: "hides",
  notify_helpr_of_booking_clash: "alerts",
  notify_ops_dispute_filed: "alerts",
  notify_saved_searches_on_new_job: "hides",
  ops_alert_condition: "alerts",
  payout_held_check: "alerts",
  payout_payee_wait_seen: "alerts",
  prevent_job_field_escalation: "locks",
  prevent_self_escalation: "locks",
  purge_old_seed_data: "cleanup",
  quote_job_funded_hires_quoter: "alerts",
  refuse_short_notice_job: "safety-skip",
  rentals_public_listing_visible: "hides",
  report_stale_dispute_settlement_claim: "alerts",
  // Closes a TEST-mode dispute without Stripe: test accounts only.
  rpc_close_test_mode_dispute: "money-gate",
  saved_search_new_counts: "hides",
  search_profiles_by_name: "hides",
  seed_hidden_for: "hides",
  seed_hidden_from_caller: "hides",
  seed_hidden_in_discovery: "hides",
  seed_review_hidden: "hides",
  shipments_from_order: "tags",
  shipments_guard_update: "locks",
  shop_give_strike: "tags",
  shop_money_rows_seed: "tags",
  shop_order_captured: "tags",
  shop_orders_seed_from_parties: "tags",
  shop_rows_seed_from_owner: "tags",
  shop_state_ok: "hides",
  shops_admin_queue: "tags",
  shops_request_order: "tags",
  shops_save_my_shop: "tags",
  sms_claim_confirmation: "hides",
  sms_claim_due: "hides",
  sweep_daily_job_digest: "hides",
  sweep_disputes_closed_without_payment: "alerts",
  sweep_idv_review_waiting: "alerts",
  sweep_job_match_queue: "alerts",
  sweep_saved_search_alert_queue: "alerts",
  tag_automated_analytics_event: "tags",
  user_error_screen_is_real: "alerts",
  user_report_is_real: "alerts",
};

/** Every edge-function file that reads is_seed. EXACT both ways. */
// @two-way src/test/isSeedCarveOutsNeedEnrolment.test.ts:toEqual(Object.keys(EDGE_READERS).sort())
const EDGE_READERS: Record<string, Kind> = {
  // A purchase is settled as a test purchase only for an enrolled test account.
  "_shared/appleAppStore.ts": "money-gate",
  "_shared/seedBoundary.ts": "hides",
  // Stripe TEST mode: enrolled AND is_seed (classifyParties).
  "_shared/stripeMode.ts": "money-gate",
  "_shared/testRecipient.ts": "hides",
  "arrival-confirm-reminder/index.ts": "hides",
  "auto-release-payment/index.ts": "alerts",
  "auto-resolve-disputes/index.ts": "alerts",
  "create-payment/index.ts": "alerts",
  "engagement-automations/index.ts": "hides",
  "money-reconciliation/index.ts": "alerts",
  "payment-confirm-reminder/index.ts": "hides",
  "process-scheduled-payouts/index.ts": "alerts",
  "release-payout/index.ts": "alerts",
  "send-push-notification/index.ts": "hides",
  "stalled-completion-reminder/index.ts": "alerts",
  "stripe-connect/index.ts": "alerts",
  "stripe-webhook/handlers/checkoutSessionCompleted.ts": "alerts",
  "stripe-webhook/handlers/paymentIntentPaymentFailed.ts": "alerts",
  "stripe-webhook/handlers/paymentIntentSucceeded.ts": "alerts",
  "stripe-webhook/handlers/settleOnboardingFee.ts": "alerts",
  "subscription-reconciliation/index.ts": "alerts",
  "void-cancelled-payments/index.ts": "alerts",
};

const sqlReaders = new Map<string, string>();
for (const [name, d] of defs) {
  const code = blankSqlComments(d.stmt);
  if (/\bis_seed\b/.test(code)) sqlReaders.set(name, code);
}

const FUNCTIONS = join(ROOT, "supabase", "functions");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}
const edgeReaders = new Map<string, string>();
for (const f of walk(FUNCTIONS)) {
  const code = blankComments(readFileSync(f, "utf8"));
  if (/\bis_seed\b/.test(code)) edgeReaders.set(relative(FUNCTIONS, f), code);
}

describe("every is_seed carve-out is classified, and a money gate needs enrolment (Q2244)", () => {
  it("finds the inventory (floor)", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(sqlReaders.size).toBeGreaterThan(100);
    expect(edgeReaders.size).toBeGreaterThan(18);
  });

  it("SQL: every function that reads is_seed is classified, exactly", () => {
    expect([...sqlReaders.keys()].sort()).toEqual(Object.keys(SQL_CARVE_OUTS).sort());
  });

  it("SQL: every money gate also reads public.test_accounts", () => {
    const bad = Object.entries(SQL_CARVE_OUTS)
      .filter(([name, k]) => k === "money-gate" && !/\bpublic\.test_accounts\b|\btest_accounts\b/.test(sqlReaders.get(name) ?? ""))
      .map(([name]) => `${name} (${defs.get(name)?.file})`);
    expect(bad).toEqual([]);
  });

  it("edge: every function file that reads is_seed is classified, exactly", () => {
    expect([...edgeReaders.keys()].sort()).toEqual(Object.keys(EDGE_READERS).sort());
  });

  it("edge: every money gate also reads test_accounts", () => {
    const bad = Object.entries(EDGE_READERS)
      .filter(([f, k]) => k === "money-gate" && !/\btest_accounts\b/.test(edgeReaders.get(f) ?? ""))
      .map(([f]) => f);
    expect(bad).toEqual([]);
  });

  it("is_seed stays out of a client's reach: prevent_self_escalation pins it on UPDATE", () => {
    expect(sqlReaders.get("prevent_self_escalation") ?? "").toMatch(/NEW\.is_seed\s*:=\s*OLD\.is_seed/);
  });

  it("the sign-up email no longer makes an account seed", () => {
    expect(defs.has("profiles_seed_from_fixture_email")).toBe(false);
  });
});
