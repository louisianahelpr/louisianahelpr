/**
 * Q105(4) class guard: no SQL function may read cron.job_run_details through a
 * subquery correlated on jobid (one per job row), except the exact list below.
 *
 * cron.job_run_details has no index but its runid key, and pg_cron's owner
 * (supabase_admin) holds it, so no migration can add one. A subquery
 * `FROM cron.job_run_details d WHERE d.jobid = j.jobid ...` inside a per-job
 * query is therefore a full scan of the whole run history per job. Measured on
 * prod 2026-09-25: sweep_dead_crons() did it 4x for 61 jobs (244 scans of
 * ~16,000 rows, 810 ms of a 1.2 s hourly call). 20260925140304 reads the
 * history once with a window pass (36 ms on the same data).
 *
 * The inventory is every function's EFFECTIVE definition after all migrations
 * (effectiveDefs), comments blanked. KNOWN_CORRELATED is exact and two-way: a
 * new correlated read fails, and so does a known one that got fixed without
 * lowering its count here.
 *
 * Behavioural proof of the sweep_dead_crons rewrite (old and new body file the
 * same rows for every verdict): src/test/pglite/sweepDeadCronsOneScan.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

// @two-way src/test/cronRunHistoryScannedOnce.test.ts:stale correlated entry
// function -> number of jobid-correlated subqueries over cron.job_run_details.
// run_missed_cron_catch_up: 5, ~288 ms per call, every 10 minutes (Q397).
// cron_dispatch_health: 1, not in cron.job and no caller in src/ or supabase/functions (2026-09-25).
const KNOWN_CORRELATED: Record<string, number> = {
  cron_dispatch_health: 1,
  run_missed_cron_catch_up: 5,
};

const CORRELATED =
  /from\s+cron\.job_run_details\s+(?:as\s+)?(\w+)\s+where\s[^;]*?\b\1\.jobid\s*=\s*(\w+)\.jobid/gi;

function correlatedCounts(): { readers: string[]; counts: Record<string, number> } {
  const readers: string[] = [];
  const counts: Record<string, number> = {};
  for (const [name, def] of effectiveDefs(MIG_DIR)) {
    const body = blankSqlComments(def.stmt);
    if (!/cron\.job_run_details/i.test(body)) continue;
    readers.push(name);
    const n = [...body.matchAll(CORRELATED)].length;
    if (n) counts[name] = n;
  }
  return { readers: readers.sort(), counts };
}

// @mutate supabase/migrations/20260925140304_sweep_dead_crons_one_scan.sql |              s.last_start, |              (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_start,
describe("Q105(4): cron run history is scanned once, not once per job", () => {
  const { readers, counts } = correlatedCounts();

  it("the inventory is real", () => {
    // Every function that reads the run history at all.
    expect(readers.length).toBeGreaterThan(4);
    expect(readers).toContain("sweep_dead_crons");
  });

  it("sweep_dead_crons reads the run history without a per-job subquery", () => {
    expect(counts.sweep_dead_crons ?? 0).toBe(0);
  });

  it("no known entry is stale (fixed or gone without lowering it here)", () => {
    const stale = Object.entries(KNOWN_CORRELATED)
      .filter(([fn, n]) => (counts[fn] ?? 0) < n)
      .map(([fn, n]) => `stale correlated entry ${fn} (${n} listed, ${counts[fn] ?? 0} found) — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("correlated reads are exactly the known list (two-way)", () => {
    expect(counts).toEqual(KNOWN_CORRELATED);
  });
});
