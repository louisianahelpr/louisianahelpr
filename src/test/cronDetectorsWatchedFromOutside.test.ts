/**
 * CJ-011: sweep-dead-crons watches the other three database cron detectors and
 * nothing watched it. scripts/cron-detectors-alive.mjs is the outside watcher,
 * run daily by schedule-heartbeat.yml. Its verdict must fail a missing,
 * inactive, never-succeeded or overdue detector, and the heartbeat must run it.
 *
 * @mutate scripts/cron-detectors-alive.mjs | else if (Number(r.hours_since_ok) > MAX_GAP_HOURS) problems.push | else if (false) problems.push
 * @mutate scripts/cron-detectors-alive.mjs | if (!r) problems.push(`${name} is not scheduled in cron.job`); | if (!r) continue;
 * @mutate .github/workflows/schedule-heartbeat.yml | run: node scripts/cron-detectors-alive.mjs  # CJ-011 external watcher | run: true
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { DETECTORS, judge } from "../../scripts/cron-detectors-alive.mjs";

const ok = (DETECTORS as string[]).map((jobname) => ({ jobname, active: true, hours_since_ok: 0.5 }));

describe("the cron detectors are watched from outside the database (CJ-011)", () => {
  it("watches all four detectors", () => {
    expect(DETECTORS).toEqual(["sweep-cron-http-failures", "sweep-silent-cron-failures", "sweep-dead-crons", "sweep-cron-blackouts"]);
  });
  it("healthy rows pass", () => {
    expect(judge(ok)).toEqual([]);
  });
  it("fails a missing, inactive, never-succeeded or overdue sweep-dead-crons", () => {
    const without = ok.filter((r) => r.jobname !== "sweep-dead-crons");
    expect(judge(without)).toHaveLength(1);
    expect(judge(ok.map((r) => (r.jobname === "sweep-dead-crons" ? { ...r, active: false } : r)))).toHaveLength(1);
    expect(judge(ok.map((r) => (r.jobname === "sweep-dead-crons" ? { ...r, hours_since_ok: null } : r)))).toHaveLength(1);
    expect(judge(ok.map((r) => (r.jobname === "sweep-dead-crons" ? { ...r, hours_since_ok: 5 } : r)))).toHaveLength(1);
  });
  it("the daily heartbeat runs it with the prod token", () => {
    const hb = readFileSync(".github/workflows/schedule-heartbeat.yml", "utf8");
    expect(hb).toContain("run: node scripts/cron-detectors-alive.mjs  # CJ-011 external watcher");
    expect(hb).toMatch(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  });
});
