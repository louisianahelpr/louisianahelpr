/**
 * Q1424: every SQL function that pg_cron runs and that reads the clock has a
 * PGlite proof that MOVES the clock, or is listed below by name as not proven.
 *
 * src/test/sweepClockProofs.test.ts (Q1357) holds the public.sweep_* functions
 * to a fixed-clock probe. The 2026-10-06 time inventory (docs/archive/
 * time-inventory.md) also named crons that are not sweep_*: auto_start_due_jobs,
 * reap_stranded_instant_payouts, detect_stuck_payments. This is the rest of
 * that class, read from the repo rather than a typed list:
 *
 *   inventory = every job's newest command in supabase/migrations
 *               (cronWorkRegister.jobCommands), the public.<fn>() calls in it,
 *               minus sweep_* (sweepClockProofs owns those), whose NEWEST
 *               definition reads now() / CURRENT_TIMESTAMP / current_date /
 *               clock_timestamp().
 *
 * Each must be in PROVEN, naming a src/test/pglite probe that names the
 * function and runs it on ./pglite/lib/fixedClock.mjs, or in NOT_PROVEN with
 * why. Both lists are EXACT both ways: a new clock-reading cron fails here
 * until someone decides, and an entry that no longer matches fails as stale.
 * The probes need ~/.lh-pglite and run by hand:
 *   node src/test/pglite/autoStartDueJobsClock.pglite.mjs   (25 PASS; RED with
 *   AUTO_START_AS_UTC=1: 9 FAILED)
 */
// @mutate src/test/clockFunctionsProven.test.ts |   auto_start_due_jobs: "autoStartDueJobsClock.pglite.mjs",\n | \n
// @mutate src/test/pglite/autoStartDueJobsClock.pglite.mjs | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs"; | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/otherClock.mjs";
// @mutate src/test/pglite/pruneRetentionClock.pglite.mjs | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs"; | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/otherClock.mjs";
// @mutate src/test/clockFunctionsProven.test.ts |   start_underfilled_crews: "startUnderfilledCrewsClock.pglite.mjs",\n | \n
// @mutate src/test/clockFunctionsProven.test.ts |   check_ops_alert_pending: "opsAlertPendingClock.pglite.mjs",\n | \n
// @mutate src/test/clockFunctionsProven.test.ts |   sms_dispatch_due: "smsDispatchClock.pglite.mjs",\n | \n
// @mutate src/test/pglite/userReportsLedgerClock.pglite.mjs | const { file, stmt } = newestFunction("check_user_reports_reach_ledger"); | const { file, stmt } = newestFunction("check_user_reports");
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { jobCommands } from "./helpers/cronWorkRegister";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const PROBES = join(ROOT, "src/test/pglite");
// localtimestamp too: prune_retention_tables reads it (fixedClock.mjs points it at the probe clock, 2026-10-13).
const CLOCK = /\bnow\s*\(\s*\)|\bcurrent_timestamp\b|\bcurrent_date\b|\bclock_timestamp\s*\(|\blocaltimestamp\b/i;

/** function -> the probe that runs it on the fixed clock. */
// @two-way src/test/clockFunctionsProven.test.ts:PROVEN names a function that is gone, not cron-run, or reads no clock
const PROVEN: Record<string, string> = {
  auto_start_due_jobs: "autoStartDueJobsClock.pglite.mjs",
  start_underfilled_crews: "startUnderfilledCrewsClock.pglite.mjs",
  prune_cron_run_log: "pruneRetentionClock.pglite.mjs",
  prune_cron_run_details: "pruneRetentionClock.pglite.mjs",
  prune_cron_http_requests: "pruneRetentionClock.pglite.mjs",
  prune_edge_rate_limit_log: "pruneRetentionClock.pglite.mjs",
  cleanup_observability_tables: "pruneRetentionClock.pglite.mjs",
  cleanup_stripe_webhook_events: "pruneRetentionClock.pglite.mjs",
  prune_retention_tables: "pruneRetentionClock.pglite.mjs",
  sms_dispatch_due: "smsDispatchClock.pglite.mjs",
  check_seed_boundary_failures: "monitorWindowsClock.pglite.mjs",
  check_error_log_throttle: "monitorWindowsClock.pglite.mjs",
  check_push_token_health: "monitorWindowsClock.pglite.mjs",
  send_ops_daily_digest: "monitorWindowsClock.pglite.mjs",
  detect_suspicious_user_patterns: "suspiciousPatternsClock.pglite.mjs",
  check_ops_alert_pending: "opsAlertPendingClock.pglite.mjs",
  check_user_reports_reach_ledger: "userReportsLedgerClock.pglite.mjs",
  check_db_saturation: "dbSaturationClock.pglite.mjs",
  run_missed_cron_catch_up: "cronCatchUpClock.pglite.mjs",
};

/** function -> why it has no fixed-clock probe yet. Each is open work under docs/OPEN.md Q1424. */
// @two-way src/test/clockFunctionsProven.test.ts:NOT_PROVEN names a function that is gone, not cron-run, reads no clock, or is proven
const NOT_PROVEN: Record<string, string> = {
  declutter_alert_overdue_checks: "b61 overdue-check admin alert (20261101042045): declutterCheckSweep.pglite.mjs proves its windows by rewriting ai_check_cleared_at and ai_check_overdue_alerted_at relative to now(), not by moving the clock; no probe runs it on fixedClock.mjs at a 1 ms edge",
  declutter_hold_unchecked_listings: "B19 fail-safe of the check after posting (20261031152545): declutterCheckAfterPost.pglite.mjs proves its 15-minute window by rewriting live_at (20 and 30 minutes back), not by moving the clock; no probe runs it on fixedClock.mjs at a 1 ms edge",
  declutter_free_still_available_sweep: "declutterFreeStillAvailable.pglite.mjs proves its 14-day windows by rewriting stored timestamps (live_at, asked_at, answered_at), relative to now(), not on fixedClock.mjs at a 1 ms edge.",
  declutter_move_reminder_sweep: "moving-sale reminders: declutterMoveReminders.pglite.mjs writes each sale's date relative to today, not by moving the clock; no probe runs it at a fixed instant yet",
  declutter_price_nudge_sweep: "CMP-5 (b): declutterPriceNudgeSweep.pglite.mjs proves its 14-day windows by rewriting stored timestamps (live_at, notified_at), not by moving the clock; no probe runs it on fixedClock.mjs",
  send_new_member_daily_summary: "LEAD-NOID21 daily new-member summary (20261031152136): newMemberDailySummary.pglite.mjs proves the queue by its summarized_at marks, not by moving the clock; it has no time window (it names everyone not yet summarized), so no fixedClock.mjs probe yet",
  guarantee_sweep: "Helpr Guarantee (owner 2026-10-27): named by helprGuarantee.pglite.mjs, which moves the stored deadlines (helpr_answer_by, fix_date, poster_answer_by), not the clock; no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (it lifts a payout hold).",
  send_application_roundups: "lead 2026-10-25: its 3-hour window is proven in emailRoundups.pglite.mjs by rewriting the stored timestamps (last_emailed_at), not by moving the clock",
  send_job_match_roundups: "lead 2026-10-25: its Louisiana-day window is proven in emailRoundups.pglite.mjs by rewriting the stored day (last_emailed_day), not by moving the clock",
  // Measured 2026-10-13 (grep of src/test/pglite for `public.<fn>(` and for fixedClock.mjs imports).
  check_browse_view_definer: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  check_stale_dispute_settlement_claims: "no PGlite probe names it. On the money path: lane A2 (money, auth and data).",
  declutter_deadline_sweep: "named by declutterSlice3.pglite.mjs (it moves row timestamps, not the clock); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Declutter slice 3, 2026-10-14).",
  declutter_handover_sweep: "named by declutterSlice4.pglite.mjs (it moves slot_start / created_at, not the clock: the 24 h auto-pay and the 7-day cancel); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Declutter slice 4, 2026-10-15).",
  helpr_task_sweep: "named by declutterDelivery.pglite.mjs (it moves open_until / pickup_slot_start / delivered_at, not the clock: the 48 h no-Helpr refund, the 2 h Helpr no-show and the 24 h door auto-confirm); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Declutter slice 5, 2026-10-16).",
  declutter_refund_request_sweep: "named by declutterRefundRequests.pglite.mjs (it moves answer_by / offer_answer_by, not the clock: an unanswered refund request or part offer goes to an admin after 24 hours); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (board 141, Declutter side, 2026-10-23).",
  // Train D (2026-10-27), measured: neither probe imports fixedClock.mjs; both move row timestamps.
  declutter_haul_away_sweep: "named by declutterHaulAwaySweep.pglite.mjs (it moves jobs.updated_at / link and listing timestamps, not the clock: the 14-day notice, the 1-day abandoned job and the 7-day link undo); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Q1962, 20261027165903).",
  declutter_wanted_sweep: "named by declutterWantedMatchManage.pglite.mjs (it moves expires_at relative to now(), not the clock: the reminder 3 days before a post ends, once); no probe runs it on fixedClock.mjs at a 1 ms edge (posting audit 10-30, 20261030221255).",
  declutter_listing_rounds_sweep: "named by declutterListingRounds.pglite.mjs (it moves listed_until relative to now(), not the clock: the 3-day reminder, the 30-day round and the end after 4 rounds); no probe runs it on fixedClock.mjs at a 1 ms edge (owner 2026-10-28, Q2461, 20261028164424).",
  declutter_pickup_reminder_sweep: "named by declutterPickupReminders.pglite.mjs (it moves slot_start relative to now(), not the clock: the 60-minute reminder window and the 50-minute exact-time title); no probe runs it on fixedClock.mjs at a 1 ms edge (20261027205028).",
  declutter_price_drop_sweep: "named by declutterSlice3.pglite.mjs (it moves last_price_drop_on / live_at, not the clock); no probe runs it on fixedClock.mjs across a Louisiana midnight (2026-10-14).",
  cron_http_tag: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  cron_record_work: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  detect_stuck_payments: "named by stuckPaymentNeedsStripeProof.pglite.mjs, moneySweepsFoundVsDone.pglite.mjs, cronWorkVisibility.pglite.mjs; no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path: lane A2 (money, auth and data).",
  reap_stranded_instant_payouts: "named by cronWorkVisibility.pglite.mjs; no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path: lane A2 (money, auth and data).",
  rentals_rent_sweep: "named by homesRentTracker.pglite.mjs (it moves due dates and created_at, not the clock: rent rows, late fees after due + grace, reminders); no probe runs it on fixedClock.mjs across a Louisiana midnight (Homes D2, 2026-10-19).",
  rentals_deposit_sweep: "named by homesDepositTracker.pglite.mjs (it moves ended_at, not the clock: the end-day, 7-days-before and overdue reminders of the one-month return); no probe runs it on fixedClock.mjs across a Louisiana midnight (Homes D6, 2026-10-19).",
};

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
const defs = effectiveDefs(MIGRATIONS);
const called = new Set<string>();
for (const { command } of jobCommands(files).values()) {
  for (const m of blankSqlComments(command).matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\s*\(/gi)) called.add(m[1].toLowerCase());
}
const clockReaders = [...called]
  .filter((fn) => !fn.startsWith("sweep_"))
  .filter((fn) => {
    const def = defs.get(fn);
    return !!def && CLOCK.test(blankSqlComments(def.stmt));
  })
  .sort();

describe("every clock-reading cron function outside sweep_* moves the clock in a probe (Q1424)", () => {
  it("reads the cron inventory (floor)", () => {
    expect(called.size).toBeGreaterThan(30);
    expect(clockReaders.length).toBeGreaterThan(5);
    expect(clockReaders).toContain("auto_start_due_jobs");
  });

  it("each is PROVEN or NOT_PROVEN, and neither list is stale", () => {
    const decided = new Set([...Object.keys(PROVEN), ...Object.keys(NOT_PROVEN)]);
    expect(clockReaders.filter((f) => !decided.has(f)), "clock-reading cron functions with no probe and no decision").toEqual([]);
    expect([...decided].filter((f) => !clockReaders.includes(f)), "stale entries").toEqual([]);
    expect(Object.keys(PROVEN).filter((f) => f in NOT_PROVEN), "in both lists").toEqual([]);
  });

  it.each(Object.entries(PROVEN))("%s: its probe names it and runs it on the fixed clock", (fn, probe) => {
    const src = readFileSync(join(PROBES, probe), "utf8");
    // Named in the probe: a newestFunction("<fn>") call, or a key of the table it loads by name.
    expect(src).toMatch(new RegExp(`newestFunction\\("${fn}"\\)|\\b${fn}:`));
    expect(src).toContain("newestFunction(");
    expect(src).toMatch(/from "\.\/lib\/fixedClock\.mjs"/);
    expect(src).toMatch(/onFixedClock\(/);
  });
});
