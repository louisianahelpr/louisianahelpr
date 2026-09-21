/**
 * Every scheduled cron must have a liveness expectation.
 *
 * `sweep_dead_crons` reads `cron_work_expectations` and LEFT JOINs `cron.job`,
 * so it can see an expectation with no job and is structurally blind to the
 * reverse. On 2026-09-14 that left `extend-boosts-hourly` and
 * `prune-cron-run-details` running with nothing watching them — a stop would
 * have been silent — and it was found only because someone ran the join by
 * hand. (The third name in docs/OPEN.md, `prune-edge-rate-limit-log`, turned
 * out to have had a 30-hour expectation since 2026-09-02.)
 *
 * Two guards, because crons arrive two ways:
 *   • THIS test covers crons added by a migration: the inventory is every
 *     `cron.schedule(...)` in supabase/migrations minus the ones a later
 *     migration unschedules, so a new cron with no expectation fails CI.
 *   • The 'unmonitored' verdict in 20260914192035's sweep_dead_crons covers
 *     crons created straight on the database, which no file can see. It reads
 *     `cron.job` itself and pages once. (`scripts/probes/alert-followups.probe.mjs`
 *     shows it red on the previous function.)
 *
 * RED before the fix: with the two INSERT rows removed from 20260914192035,
 * "every scheduled cron has a liveness expectation" lists
 * prune-cron-run-details. (extend-boosts-hourly has no cron.schedule call
 * anywhere in the repo — it was created outside migrations — which is exactly
 * why the second, live guard exists.)
 */
// @mutate supabase/migrations/20260914192035_alert_followups_support_cron_coverage_client_origin.sql | ('extend-boosts-hourly',   interval '3 hours'),\n    ('prune-cron-run-details', interval '30 hours') | ('extend-boosts-hourly',   interval '3 hours')
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = process.env.CRON_COVERAGE_MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }));
}

/**
 * Jobs the migrations leave scheduled, in filename order (the order they are
 * applied): `cron.schedule` upserts by name, `cron.unschedule` removes.
 * Deliberately independent of the expectation list it is compared against —
 * a registry compared against itself cannot fail.
 */
export function scheduledJobs(files: { file: string; sql: string }[]): Map<string, string> {
  const live = new Map<string, string>();
  for (const { file, sql } of files) {
    // One pass, in the order the statements appear: a file that unschedules a
    // job and then reschedules it (the common "move the minute" edit) must end
    // with the job scheduled, which two separate passes would get backwards.
    for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(\s*'([a-z0-9-]+)'/gi)) {
      if (m[1].toLowerCase() === "schedule") live.set(m[2], file);
      else live.delete(m[2]);
    }
  }
  return live;
}

/** Every jobname a migration gives an `expected_max_gap`, latest file wins. */
export function livenessExpectations(files: { file: string; sql: string }[]): Set<string> {
  const out = new Set<string>();
  for (const { sql } of files) {
    for (const block of sql.matchAll(
      /INSERT\s+INTO\s+public\.cron_work_expectations\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi,
    )) {
      const cols = block[1].split(",").map((c) => c.trim().toLowerCase());
      const gapCol = cols.indexOf("expected_max_gap");
      if (gapCol === -1) continue;
      // One row per parenthesised tuple in the VALUES list.
      for (const row of block[2].matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        const name = /^\s*'([a-z0-9-]+)'/i.exec(row[1])?.[1];
        if (name) out.add(name);
      }
    }
  }
  return out;
}

describe("cron liveness coverage", () => {
  const files = migrations();

  it("the inventory is read from the migrations, not from a list", () => {
    const scheduled = scheduledJobs(files);
    expect(scheduled.size).toBeGreaterThan(3);
    // Proof the unschedule half works: a job scheduled and later removed is gone.
    expect(scheduled.has("one-shot-test-auto-expire")).toBe(false);
  });

  it("every scheduled cron has a liveness expectation", () => {
    const expectations = livenessExpectations(files);
    const uncovered = [...scheduledJobs(files).entries()]
      .filter(([name]) => !expectations.has(name))
      .map(([name, file]) => `${name} (scheduled in ${file})`);
    expect(uncovered).toEqual([]);
  });

  it("the two 2026-09-14 gaps are covered, with tolerances matching their schedules", () => {
    const sql = files.map((f) => f.sql).join("\n");
    expect(sql).toMatch(/\('extend-boosts-hourly',\s*interval '3 hours'\)/);
    expect(sql).toMatch(/\('prune-cron-run-details',\s*interval '30 hours'\)/);
  });

  it("sweep_dead_crons also reads cron.job itself, so a cron added outside a migration is seen", () => {
    const latest = files.filter((f) => f.sql.includes("FUNCTION public.sweep_dead_crons()")).pop()!;
    expect(latest.sql).toMatch(/FROM cron\.job j/);
    expect(latest.sql).toMatch(/'unmonitored'/);
    expect(latest.sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.cron_work_expectations/);
  });
});
