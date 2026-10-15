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
 *   node src/test/pglite/opsMonitorWindowsClock.pglite.mjs   (ALL PASS; RED with
 *   OPS_MONITOR_EDGES_MOVED=1: 8 FAILED, measured 2026-10-15)
 */
// @mutate src/test/clockFunctionsProven.test.ts |   auto_start_due_jobs: "autoStartDueJobsClock.pglite.mjs",\n | \n
// @mutate src/test/pglite/autoStartDueJobsClock.pglite.mjs | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs"; | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/otherClock.mjs";
// @mutate src/test/pglite/pruneRetentionClock.pglite.mjs | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs"; | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/otherClock.mjs";
// @mutate src/test/clockFunctionsProven.test.ts |   start_underfilled_crews: "startUnderfilledCrewsClock.pglite.mjs",\n | \n
// @mutate src/test/clockFunctionsProven.test.ts |   check_db_saturation: "opsMonitorWindowsClock.pglite.mjs",\n | \n
// @mutate src/test/pglite/opsMonitorWindowsClock.pglite.mjs | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs"; | import { installClock, newestFunction, onFixedClock, setClock } from "./lib/otherClock.mjs";
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
  check_seed_boundary_failures: "monitorWindowsClock.pglite.mjs",
  check_error_log_throttle: "monitorWindowsClock.pglite.mjs",
  check_push_token_health: "monitorWindowsClock.pglite.mjs",
  send_ops_daily_digest: "monitorWindowsClock.pglite.mjs",
  detect_suspicious_user_patterns: "suspiciousPatternsClock.pglite.mjs",
  check_ops_alert_pending: "opsMonitorWindowsClock.pglite.mjs",
  check_user_reports_reach_ledger: "opsMonitorWindowsClock.pglite.mjs",
  check_db_saturation: "opsMonitorWindowsClock.pglite.mjs",
};

/** function -> why it has no fixed-clock probe yet. Each is open work under docs/OPEN.md Q1424. */
// @two-way src/test/clockFunctionsProven.test.ts:NOT_PROVEN names a function that is gone, not cron-run, reads no clock, or is proven
const NOT_PROVEN: Record<string, string> = {
  // Measured 2026-10-13 (grep of src/test/pglite for `public.<fn>(` and for fixedClock.mjs imports).
  check_browse_view_definer: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  check_stale_dispute_settlement_claims: "no PGlite probe names it. On the money path: lane A2 (money, auth and data).",
  declutter_deadline_sweep: "named by declutterSlice3.pglite.mjs (it moves row timestamps, not the clock); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Declutter slice 3, 2026-10-14).",
  declutter_handover_sweep: "named by declutterSlice4.pglite.mjs (it moves slot_start / created_at, not the clock: the 24 h auto-pay and the 7-day cancel); no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path (Declutter slice 4, 2026-10-15).",
  declutter_price_drop_sweep: "named by declutterSlice3.pglite.mjs (it moves last_price_drop_on / live_at, not the clock); no probe runs it on fixedClock.mjs across a Louisiana midnight (2026-10-14).",
  cron_http_tag: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  cron_record_work: "reads the clock only to stamp a row or a message; it has no time window to prove (newest body read 2026-10-13)",
  detect_stuck_payments: "named by stuckPaymentNeedsStripeProof.pglite.mjs, moneySweepsFoundVsDone.pglite.mjs, cronWorkVisibility.pglite.mjs; no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path: lane A2 (money, auth and data).",
  reap_stranded_instant_payouts: "named by cronWorkVisibility.pglite.mjs; no probe runs it on fixedClock.mjs at a 1 ms edge. On the money path: lane A2 (money, auth and data).",
  run_missed_cron_catch_up: "named by cronCatchUp.pglite.mjs, cronCatchUpHttpOutcome.pglite.mjs, cronCatchUpOneScan.pglite.mjs; no probe runs it on fixedClock.mjs at a 1 ms edge",
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
