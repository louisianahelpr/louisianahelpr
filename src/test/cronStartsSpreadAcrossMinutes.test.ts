/**
 * CLASS GUARD (Q786): no minute of the week starts more cron jobs than the
 * connection budget reserves for pg_cron.
 *
 * THE BUG (measured). quota-monitor's "Postgres connection budget (Q317)"
 * (scripts/check-db-pool-budget.mjs) reserves max(CRON_RESERVE_FLOOR, busiest
 * start-minute in cron.job_run_details) connections for pg_cron, because each
 * job that starts in a minute opens its own backend. On 2026-09-27 the busiest
 * minute was 14:00Z with 12 starts every day (hourly, every-5, every-15, every-minute
 * and two daily jobs all on :00), and the check went red at demand 59 vs 57
 * usable (issue #1890). 20260928000013_spread_top_of_hour_cron_starts moved
 * five jobs earlier; the busiest scheduled minute is now 8.
 *
 * THE CLASS, from the migrations: every job they leave scheduled, with its
 * EFFECTIVE schedule (cron.schedule / cron.unschedule, plus the
 * ('name', 'schedule') tuples of migrations that re-time jobs with
 * cron.alter_job; same parse as cronCatchUpPolicy.test.ts), expanded over a
 * whole week. The busiest minute must stay within CRON_RESERVE_FLOOR, read
 * from the budget script itself so the two cannot drift.
 *
 * Jobs created outside migrations (e.g. extend-boosts-hourly) are invisible to
 * this file scan; the live budget check still counts them, and the
 * migration above re-times them by name.
 *
 * @mutate supabase/migrations/20260928000013_spread_top_of_hour_cron_starts.sql | ('sweep-expired-auto-bans',     '52 * * * *'),\n      ('stalled-completion-reminder', '46 13 * * *'),\n      ('sweep-daily-job-digest',      '56 13 * * *'), | ('sweep-expired-auto-bans',     '0 * * * *'),\n      ('stalled-completion-reminder', '0 14 * * *'),\n      ('sweep-daily-job-digest',      '0 14 * * *'),
 * @mutate supabase/migrations/20260928000013_spread_top_of_hour_cron_starts.sql | ('stalled-completion-reminder', '46 13 * * *'), | ('stalled-completion-reminder', '0 14 * * *'),
 * @mutate scripts/check-db-pool-budget.mjs | const CRON_RESERVE_FLOOR = 10; | const CRON_RESERVE_FLOOR = 6;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => blankSqlComments(readFileSync(join(MIG, file), "utf8")));

const F = String.raw`[0-9*][0-9*,/\-]*`;
const EXPR = `${F}\\s+${F}\\s+${F}\\s+${F}\\s+${F}`;
const EVENT_RE = new RegExp(
  String.raw`cron\.(schedule|unschedule)\s*\(\s*(?:job_name\s*:=\s*)?'([a-z0-9-]+)'(?:\s*,\s*(?:schedule\s*:=\s*)?'(${EXPR})')?` +
    String.raw`|\(\s*'([a-z0-9-]+)'\s*,\s*'(${EXPR})'\s*\)` +
    String.raw`|jobname\s*=\s*'([a-z0-9-]+)'[\s\S]{0,400}?cron\.alter_job\s*\([^;]*?schedule\s*:=\s*'(${EXPR})'`,
  "gi",
);
const schedules = new Map<string, string>();
for (const sql of files) {
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

/** Values a cron field matches, over [lo, hi]. */
function field(f: string, lo: number, hi: number): number[] {
  const out = new Set<number>();
  for (const raw of f.split(",")) {
    const [range, stepStr] = raw.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let a: number, b: number;
    if (range === "*") [a, b] = [lo, hi];
    else if (range.includes("-")) [a, b] = range.split("-").map(Number) as [number, number];
    else [a, b] = [Number(range), stepStr ? hi : Number(range)];
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out];
}

/** Starts per minute of the week (day-of-month/month ignored: all jobs use '*'). */
const load = new Map<string, string[]>();
for (const [name, sched] of schedules) {
  const [m, h, , , dow] = sched.trim().split(/\s+/);
  for (const d of field(dow, 0, 6))
    for (const hh of field(h, 0, 23))
      for (const mm of field(m, 0, 59)) {
        const k = `d${d} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        load.set(k, [...(load.get(k) ?? []), name]);
      }
}
const [busiestAt, busiestJobs] = [...load].sort((a, b) => b[1].length - a[1].length)[0];

const budget = readFileSync(join(ROOT, "scripts", "check-db-pool-budget.mjs"), "utf8");
const FLOOR = Number(/const CRON_RESERVE_FLOOR = (\d+);/.exec(budget)?.[1]);

describe("cron starts spread across minutes (Q786)", () => {
  it("reads the inventory from the migrations (floor)", () => {
    // 60+ scheduled jobs parsed on 2026-09-27; far fewer means the parse broke.
    expect(schedules.size).toBeGreaterThan(50);
    expect(schedules.get("job-match-queue")).toBe("* * * * *");
    expect(Number.isFinite(FLOOR) && FLOOR > 0).toBe(true);
  });

  it("the moved jobs keep their new, earlier minute", () => {
    expect(schedules.get("sweep-daily-job-digest")).toBe("56 13 * * *");
    expect(schedules.get("stalled-completion-reminder")).toBe("46 13 * * *");
    expect(schedules.get("sweep-old-email-send-log")).toBe("46 3 * * *");
  });

  it("no minute starts more jobs than CRON_RESERVE_FLOOR", () => {
    expect(
      busiestJobs.length,
      `${busiestAt} starts ${busiestJobs.length} jobs (> ${FLOOR}): ${busiestJobs.join(", ")}`,
    ).toBeLessThanOrEqual(FLOOR);
  });
});
