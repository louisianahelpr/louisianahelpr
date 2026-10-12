/**
 * Q1357: every sweep_* SQL function that reads the clock has a PGlite proof that
 * MOVES the clock.
 *
 * Inventory from source: the newest definition of every public.sweep_* function
 * across supabase/migrations (any dollar tag) whose body reads now(),
 * CURRENT_TIMESTAMP, current_date or clock_timestamp(). Each must be in PROVEN,
 * naming a src/test/pglite probe that names the function and runs it on
 * src/test/pglite/lib/fixedClock.mjs (rows either side of the cutoff at a fixed
 * instant). Two-way and EXACT: a new clock-reading sweep with no probe fails, and
 * so does a stale entry. There is no "not proven yet" list (it emptied
 * 2026-10-12, Q1357). The probes themselves need ~/.lh-pglite and run by hand:
 *   node src/test/pglite/sweepClockBoundaries.pglite.mjs  (55 PASS; FAIL on each
 *   boundary made `<=`: error_logs 30 days 6, signup_leads 3, auto ban expiry 3,
 *   payout freeze 6 h verify 6 / 5 min kick 6 / 30 min page 3 / 6 h re-page 3,
 *   ban review 24 h page 3 / re-page 3, job start window 36 min 3 / opened 1 s
 *   early 3 / read as UTC instead of Central 4; 90 -> 89 days 12)
 *   node src/test/pglite/sweepCronMonitorClock.pglite.mjs  (77 PASS; FAIL on each
 *   edge made inclusive: blackout 24 h 6 (it and dead_crons' raised window),
 *   startup 20 min 3 / re-page 3, http 60 min 3 / catch-up 2 h 3 / untagged
 *   UTC day 3, dead 1 h 3 / raised 24 h 3 / UTC day 3, silent 6 h 3 / 30 d 3)
 *   node src/test/pglite/sweepNotifyQueueClock.pglite.mjs  (57 PASS; FAIL on: digest
 *   24 h made inclusive 3 / 23 h re-send 3, early-access hold `<` in all three 9,
 *   retry_after `<` 6, backoff 5 -> 6 min 9, dropped settled_at moved 3)
 *   node src/test/pglite/sweepCentralStartClock.pglite.mjs  (108 PASS; FAIL on each
 *   edge moved 1 ms or made strict/inclusive: day-of 24 h start 3 / end 3 / accept
 *   grace 3 / 12 h poster alert 3, no-show 6 h 3 / 30 min 3, backout notice
 *   30 min 3 / re-push 2 h 3 / 24 h window 6, last chance 22 h 3 / 24 h 3,
 *   repost 2 h 3 / reminder 3 h 3; Central read as UTC 51)
 *
 * @mutate src/test/sweepClockProofs.test.ts | sweep_old_notifications: "sweepClockBoundaries.pglite.mjs",\n  sweep_open_ban | sweep_old_notification: "sweepClockBoundaries.pglite.mjs",\n  sweep_open_ban
 * @mutate src/test/sweepClockProofs.test.ts | const PROVEN: Record<string, string> = {\n | const PROVEN: Record<string, string> = {\n  sweep_gone_long_ago: "sweepClockBoundaries.pglite.mjs",\n
 * @mutate src/test/sweepClockProofs.test.ts |   sweep_no_show_alerts: "sweepCentralStartClock.pglite.mjs",\n | \n
 * @mutate src/test/pglite/sweepClockBoundaries.pglite.mjs | } from "./lib/fixedClock.mjs"; | } from "./lib/otherClock.mjs";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const PROBES = "src/test/pglite";
const CLOCK = /\bnow\s*\(\s*\)|\bcurrent_timestamp\b|\bcurrent_date\b|\bclock_timestamp\s*\(/i;

/** sweep_* function -> the probe that runs it on the fixed clock. */
// @two-way src/test/sweepClockProofs.test.ts:PROVEN names a sweep that is gone or reads no clock
const PROVEN: Record<string, string> = {
  sweep_backout_notice_reminders: "sweepCentralStartClock.pglite.mjs",
  sweep_confirm_reminders_and_repost: "sweepCentralStartClock.pglite.mjs",
  sweep_unfilled_series_visit_reminders: "unfilledSeriesVisitReminder.pglite.mjs",
  sweep_cron_blackouts: "sweepCronMonitorClock.pglite.mjs",
  sweep_cron_http_failures: "sweepCronMonitorClock.pglite.mjs",
  sweep_cron_startup_failures: "sweepCronMonitorClock.pglite.mjs",
  sweep_daily_job_digest: "sweepNotifyQueueClock.pglite.mjs",
  sweep_dayof_confirm_reminders: "sweepCentralStartClock.pglite.mjs",
  sweep_dead_crons: "sweepCronMonitorClock.pglite.mjs",
  sweep_expired_auto_bans: "sweepClockBoundaries.pglite.mjs",
  sweep_job_match_queue: "sweepNotifyQueueClock.pglite.mjs",
  sweep_job_start_reminders: "sweepClockBoundaries.pglite.mjs",
  sweep_no_show_alerts: "sweepCentralStartClock.pglite.mjs",
  sweep_old_email_send_log: "sweepClockBoundaries.pglite.mjs",
  sweep_old_error_logs: "sweepClockBoundaries.pglite.mjs",
  sweep_old_notifications: "sweepClockBoundaries.pglite.mjs",
  sweep_open_ban_settlement_reviews: "sweepClockBoundaries.pglite.mjs",
  sweep_payout_schedule_freezes: "sweepClockBoundaries.pglite.mjs",
  sweep_release_last_chance: "sweepCentralStartClock.pglite.mjs",
  sweep_saved_search_alert_queue: "sweepNotifyQueueClock.pglite.mjs",
  sweep_signup_leads: "sweepClockBoundaries.pglite.mjs",
  sweep_silent_cron_failures: "sweepCronMonitorClock.pglite.mjs",
};

const clockSweeps = (): string[] => {
  const out: string[] = [];
  for (const [name, def] of effectiveDefs("supabase/migrations")) {
    if (/^sweep_/.test(name) && CLOCK.test(blankSqlComments(def.stmt))) out.push(name);
  }
  return out.sort();
};

describe("Q1357: every clock-reading sweep_* has a fixed-clock PGlite proof", () => {
  const sweeps = clockSweeps();

  it("the inventory reads the migrations (floor)", () => {
    expect(sweeps.length).toBeGreaterThan(15);
    expect(sweeps).toContain("sweep_old_error_logs");
  });

  it("each is PROVEN, and PROVEN names no sweep that is gone or reads no clock", () => {
    expect(sweeps.filter((s) => !(s in PROVEN)), "a clock-reading sweep with no fixed-clock proof: write one (src/test/pglite/lib/fixedClock.mjs)").toEqual([]);
    expect(Object.keys(PROVEN).filter((s) => !sweeps.includes(s)), "PROVEN names a sweep that is gone or reads no clock").toEqual([]);
  });

  it("each PROVEN probe names the sweep and runs it on the fixed clock", () => {
    const bad: string[] = [];
    for (const [sweep, probe] of Object.entries(PROVEN)) {
      const src = readFileSync(join(PROBES, probe), "utf8");
      const named = new RegExp(`["']${sweep}["']`).test(src);
      const onClock = /from\s+["']\.\/lib\/fixedClock\.mjs["']/.test(src) && /\bonFixedClock\s*\(/.test(src) && /\bsetClock\s*\(/.test(src);
      if (!named || !onClock) bad.push(`${sweep} -> ${probe}${named ? "" : " (does not name it)"}${onClock ? "" : " (not on fixedClock.mjs)"}`);
    }
    expect(bad).toEqual([]);
  });
});
