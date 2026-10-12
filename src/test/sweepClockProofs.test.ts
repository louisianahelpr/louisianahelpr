/**
 * Q1357: every sweep_* SQL function that reads the clock has a PGlite proof that
 * MOVES the clock, or is named here as not proven yet.
 *
 * Inventory from source: the newest definition of every public.sweep_* function
 * across supabase/migrations (any dollar tag) whose body reads now(),
 * CURRENT_TIMESTAMP, current_date or clock_timestamp(). Each must be either in
 * PROVEN, naming a src/test/pglite probe that names the function and runs it on
 * src/test/pglite/lib/fixedClock.mjs (rows either side of the cutoff at a fixed
 * instant), or in NOT_YET_PROVEN. Two-way and EXACT: a stale entry fails, a
 * name in both fails, and NOT_YET_PROVEN only shrinks (Q1357 closes when it is
 * empty). The probes themselves need ~/.lh-pglite and run by hand:
 *   node src/test/pglite/sweepClockBoundaries.pglite.mjs  (55 PASS; FAIL on each
 *   boundary made `<=`: error_logs 30 days 6, signup_leads 3, auto ban expiry 3,
 *   payout freeze 6 h verify 6 / 5 min kick 6 / 30 min page 3 / 6 h re-page 3,
 *   ban review 24 h page 3 / re-page 3, job start window 36 min 3 / opened 1 s
 *   early 3 / read as UTC instead of Central 4; 90 -> 89 days 12)
 *   node src/test/pglite/sweepCronMonitorClock.pglite.mjs  (77 PASS; FAIL on each
 *   edge made inclusive: blackout 24 h 6 (it and dead_crons' raised window),
 *   startup 20 min 3 / re-page 3, http 60 min 3 / catch-up 2 h 3 / untagged
 *   UTC day 3, dead 1 h 3 / raised 24 h 3 / UTC day 3, silent 6 h 3 / 30 d 3)
 *
 * @mutate src/test/sweepClockProofs.test.ts |   sweep_old_notifications: "sweepClockBoundaries.pglite.mjs", |   sweep_old_notification: "sweepClockBoundaries.pglite.mjs",
 * @mutate src/test/sweepClockProofs.test.ts |   "sweep_saved_search_alert_queue",\n |   "sweep_saved_search_alert_queue",\n  "sweep_old_error_logs",\n
 * @mutate src/test/sweepClockProofs.test.ts |   "sweep_no_show_alerts",\n | \n
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
  sweep_cron_blackouts: "sweepCronMonitorClock.pglite.mjs",
  sweep_cron_http_failures: "sweepCronMonitorClock.pglite.mjs",
  sweep_cron_startup_failures: "sweepCronMonitorClock.pglite.mjs",
  sweep_dead_crons: "sweepCronMonitorClock.pglite.mjs",
  sweep_expired_auto_bans: "sweepClockBoundaries.pglite.mjs",
  sweep_job_start_reminders: "sweepClockBoundaries.pglite.mjs",
  sweep_old_email_send_log: "sweepClockBoundaries.pglite.mjs",
  sweep_old_error_logs: "sweepClockBoundaries.pglite.mjs",
  sweep_old_notifications: "sweepClockBoundaries.pglite.mjs",
  sweep_open_ban_settlement_reviews: "sweepClockBoundaries.pglite.mjs",
  sweep_payout_schedule_freezes: "sweepClockBoundaries.pglite.mjs",
  sweep_signup_leads: "sweepClockBoundaries.pglite.mjs",
  sweep_silent_cron_failures: "sweepCronMonitorClock.pglite.mjs",
};

/** EXACT (2026-10-12): clock-reading sweeps with no fixed-clock proof yet. Only shrinks. */
// @two-way src/test/sweepClockProofs.test.ts:NOT_YET_PROVEN names a sweep that is gone or reads no clock
const NOT_YET_PROVEN = [
  "sweep_backout_notice_reminders",
  "sweep_confirm_reminders_and_repost",
  "sweep_daily_job_digest",
  "sweep_dayof_confirm_reminders",
  "sweep_job_match_queue",
  "sweep_no_show_alerts",
  "sweep_release_last_chance",
  "sweep_saved_search_alert_queue",
];

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

  it("each is PROVEN or NOT_YET_PROVEN, never both, and neither list is stale", () => {
    const listed = new Set([...Object.keys(PROVEN), ...NOT_YET_PROVEN]);
    expect(sweeps.filter((s) => !listed.has(s)), "a clock-reading sweep with no fixed-clock proof: write one (src/test/pglite/lib/fixedClock.mjs)").toEqual([]);
    expect(Object.keys(PROVEN).filter((s) => NOT_YET_PROVEN.includes(s)), "named PROVEN and NOT_YET_PROVEN: drop it from NOT_YET_PROVEN").toEqual([]);
    expect(Object.keys(PROVEN).filter((s) => !sweeps.includes(s)), "PROVEN names a sweep that is gone or reads no clock").toEqual([]);
    expect(NOT_YET_PROVEN.filter((s) => !sweeps.includes(s)), "NOT_YET_PROVEN names a sweep that is gone or reads no clock").toEqual([]);
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
