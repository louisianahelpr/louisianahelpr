/**
 * CLASS GUARD (Q30): every daily/weekly cron says whether a missed slot may be
 * re-run late, and nothing that moves money or deletes data ever is.
 *
 * THE BUG (measured, cron.job_run_details). 2026-09-22 daily-match-digest
 * 13:12, sweep-daily-job-digest 14:00 and ops-daily-digest 14:40 UTC failed
 * with "job startup timeout" during the DB outage (Q53). Nothing re-runs a
 * missed slot, so the day was lost and ops alerting went ~38h without a
 * digest. run_missed_cron_catch_up() (every 10 min) now re-runs a missed slot
 * ONCE for jobs in cron_catchup_policy with catch_up = true, and alerts for
 * every other daily/weekly job. Behaviour is proven in PGlite:
 * src/test/pglite/cronCatchUp.pglite.mjs.
 *
 * THE CLASS, from the migrations: every cron job they leave scheduled
 * (cron.schedule / cron.unschedule, plus the ('name', 'schedule') tuples of
 * the migrations that re-time jobs with cron.alter_job), with its EFFECTIVE
 * schedule, filtered to daily ('M H * * *') and weekly ('M H * * D'). On
 * 2026-09-23 that parse equalled live cron.job for all 23 daily/weekly jobs.
 * A job that runs every few minutes or hours heals itself on its next run.
 *
 * Checks, all two-way:
 *   - policy rows (newest migration that seeds cron_catchup_policy) ==
 *     daily/weekly inventory, exactly;
 *   - catch_up = true set == CATCH_UP_SAFE below, exactly;
 *   - no job named for money or deletion is catch-up-safe;
 *   - the newest run_missed_cron_catch_up() claims a slot before running it,
 *     skips claimed slots, never queues behind a lock, and treats a missing
 *     policy row as unsafe.
 *
 * @mutate supabase/migrations/20260923145117_weekly_report_catch_up_safe.sql | ('charge-recurring-visits',         false, | ('charge-recurring-visits',         true,
 * @mutate supabase/migrations/20260923145117_weekly_report_catch_up_safe.sql | ('ops-daily-digest',                true, | ('ops-daily-digest-gone',           true,
 * @mutate supabase/migrations/20260923145516_catch_up_too_late_wording.sql | IF NOT pg_try_advisory_xact_lock(hashtext( | IF NOT pg_advisory_xact_lock(hashtext(
 * @mutate supabase/migrations/20260923145516_catch_up_too_late_wording.sql | AND NOT EXISTS (SELECT 1 FROM public.cron_catchup_runs c | AND EXISTS (SELECT 1 FROM public.cron_catchup_runs c
 * @mutate supabase/migrations/20260923145516_catch_up_too_late_wording.sql | ELSIF r.catch_up IS NOT TRUE THEN | ELSIF false THEN
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: blankSqlComments(readFileSync(join(MIG, file), "utf8")) }));

/** Exactly the jobs that may be re-run late, each with its reason in the migration. */
const CATCH_UP_SAFE = [
  "cleanup-notifications",
  "cleanup-observability-tables",
  "cleanup-stripe-webhook-events",
  "daily-match-digest",
  "detect-suspicious-user-patterns",
  "engagement-automations",
  "expiring-jobs-push",
  "marketing-token-health",
  "money-reconciliation",
  "ops-daily-digest",
  "prune-cron-run-details",
  "prune-cron-run-log",
  "prune-edge-rate-limit-log",
  "push-token-health",
  "review-nag-cron",
  "stalled-completion-reminder",
  "sweep-daily-job-digest",
  "sweep-old-email-send-log",
  "sweep-old-error-logs",
  "sweep-old-notifications",
  "weekly-helper-report",
];

/** Names that move money, change entitlements or delete accounts: never catch-up-safe. */
const NEVER_RERUN = /charge|payout|refund|subscription|abandoned|release|capture|tip-|void-/;

// ── inventory: effective schedule per job, in migration order ──────────────
const F = String.raw`[0-9*][0-9*,/\-]*`;
const EXPR = `${F}\\s+${F}\\s+${F}\\s+${F}\\s+${F}`;
const EVENT_RE = new RegExp(
  String.raw`cron\.(schedule|unschedule)\s*\(\s*(?:job_name\s*:=\s*)?'([a-z0-9-]+)'(?:\s*,\s*(?:schedule\s*:=\s*)?'(${EXPR})')?` +
    String.raw`|\(\s*'([a-z0-9-]+)'\s*,\s*'(${EXPR})'\s*\)` +
    String.raw`|jobname\s*=\s*'([a-z0-9-]+)'[\s\S]{0,400}?cron\.alter_job\s*\([^;]*?schedule\s*:=\s*'(${EXPR})'`,
  "gi",
);
const schedules = new Map<string, string>();
for (const { sql } of files) {
  const retimes = /cron\.(alter_job|schedule)\s*\(/i.test(sql);
  for (const m of sql.matchAll(EVENT_RE)) {
    if (m[1]) {
      if (m[1].toLowerCase() === "unschedule") schedules.delete(m[2]);
      else if (m[3]) schedules.set(m[2], m[3]);
    } else if (m[4]) {
      if (retimes) schedules.set(m[4], m[5]);
    } else if (m[6]) schedules.set(m[6], m[7]);
  }
}
const DAILY = /^\s*\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*\s*$/;
const WEEKLY = /^\s*\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\d\s*$/;
const dailyWeekly = new Map([...schedules].filter(([, s]) => DAILY.test(s) || WEEKLY.test(s)));

// ── policy: rows of the newest migration that seeds it ─────────────────────
const policyFile = [...files].reverse().find((f) => /INSERT\s+INTO\s+public\.cron_catchup_policy\b/i.test(f.sql));
const ROW_RE = /\(\s*'([a-z0-9-]+)'\s*,\s*(true|false)\s*,\s*interval\s*'(\d+) (hours?|minutes?)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
const policy = new Map<string, { safe: boolean; hours: number; reason: string }>();
if (policyFile) {
  const block = /INSERT\s+INTO\s+public\.cron_catchup_policy\b[\s\S]*?\bON\s+CONFLICT\b/i.exec(policyFile.sql)![0];
  for (const m of block.matchAll(ROW_RE)) {
    policy.set(m[1], { safe: m[2] === "true", hours: Number(m[3]) / (m[4].startsWith("minute") ? 60 : 1), reason: m[5] });
  }
}

// ── the function: newest definition, any dollar tag ────────────────────────
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?run_missed_cron_catch_up\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
let fnBody = "";
for (const { sql } of files) for (const m of sql.matchAll(FN_RE)) fnBody = m[2];

describe("missed daily/weekly cron slots: catch-up policy (Q30)", () => {
  it("reads the inventory from the migrations (floor)", () => {
    // 23 daily/weekly jobs on 2026-09-23 (equal to live cron.job that day).
    expect(dailyWeekly.size).toBeGreaterThan(20);
    expect(dailyWeekly.get("ops-daily-digest")).toBe("40 14 * * *");
    expect(dailyWeekly.get("weekly-helper-report")).toBe("19 14 * * 1");
    // Re-timed by cron.alter_job, not cron.schedule: the parse follows it.
    expect(schedules.get("payment-confirm-reminder")).toBe("15 */6 * * *");
    expect(dailyWeekly.has("payment-confirm-reminder")).toBe(false);
    expect(policy.size).toBeGreaterThan(20);
  });

  it("every daily/weekly job has a policy row, and every row is a daily/weekly job", () => {
    const missing = [...dailyWeekly.keys()].filter((n) => !policy.has(n)).sort();
    const extra = [...policy.keys()].filter((n) => !dailyWeekly.has(n)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("the catch-up-safe set is exactly the allowlist", () => {
    const safe = [...policy].filter(([, p]) => p.safe).map(([n]) => n).sort();
    expect(safe).toEqual([...CATCH_UP_SAFE].sort());
  });

  it("nothing that moves money, changes entitlements or deletes accounts is catch-up-safe", () => {
    const bad = [...policy].filter(([n, p]) => p.safe && NEVER_RERUN.test(n)).map(([n]) => n);
    expect(bad).toEqual([]);
    for (const n of ["charge-recurring-visits", "expire-subscriptions", "subscription-reconciliation", "cleanup-abandoned-accounts"]) {
      expect(policy.get(n)?.safe, n).toBe(false);
    }
  });

  it("every row says why, and a daily job's window ends before its next slot", () => {
    for (const [n, p] of policy) {
      expect(p.reason.length, n).toBeGreaterThanOrEqual(20);
      const period = WEEKLY.test(dailyWeekly.get(n) ?? "") ? 168 : 24;
      expect(p.hours, n).toBeLessThan(period);
    }
  });

  it("run_missed_cron_catch_up claims a slot once, never waits, and treats unknown as unsafe", () => {
    expect(fnBody.length).toBeGreaterThan(500);
    // Never queue behind another tick.
    expect(fnBody).toMatch(/IF\s+NOT\s+pg_try_advisory_xact_lock\s*\(/i);
    expect(fnBody).not.toMatch(/\bpg_advisory_(?:xact_)?lock\s*\(/i);
    expect(fnBody).toMatch(/set_config\(\s*'lock_timeout'\s*,\s*'\d+ms'\s*,\s*true\s*\)/i);
    // A slot already decided is never picked up again.
    expect(fnBody).toMatch(/AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.cron_catchup_runs\s+c\s+WHERE\s+c\.jobname\s*=\s*j\.jobname\s+AND\s+c\.slot\s*=\s*s\.slot\s*\)/i);
    // The claim is written before the command runs.
    const claim = fnBody.search(/INSERT\s+INTO\s+public\.cron_catchup_runs/i);
    const exec = fnBody.search(/\bEXECUTE\s+regexp_replace\(\s*r\.command/i);
    expect(claim).toBeGreaterThan(-1);
    expect(exec).toBeGreaterThan(claim);
    // No policy row -> alert; catch_up false -> alert; neither runs the command.
    expect(fnBody).toMatch(/IF\s+r\.catch_up\s+IS\s+NULL\s+THEN\s+v_action\s*:=\s*'alerted_unclassified'/i);
    expect(fnBody).toMatch(/ELSIF\s+r\.catch_up\s+IS\s+NOT\s+TRUE\s+THEN\s+v_action\s*:=\s*'alerted_unsafe'/i);
    expect(fnBody).toMatch(/IF\s+v_action\s*=\s*'caught_up'\s+THEN\s+v_ran\s*:=\s*v_ran\s*\+\s*1;\s*BEGIN\s+EXECUTE/i);
  });

  it("the catch-up cron itself runs every few minutes, so it is not in its own inventory", () => {
    expect(schedules.get("cron-missed-slot-catch-up")).toBe("9-59/10 * * * *");
    expect(dailyWeekly.has("cron-missed-slot-catch-up")).toBe(false);
  });
});
