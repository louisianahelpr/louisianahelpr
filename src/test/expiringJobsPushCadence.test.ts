/**
 * Q994 — expiring-jobs-push runs often enough to warn a short-lead listing.
 *
 * THE DEFECT. The push warns a poster whose open job expires within 24 hours.
 * It ran once a day (14:14 UTC), so a listing posted after the run and expiring
 * before the next one was never inside any run's window while it was open: the
 * jobs with the shortest lead time, the ones most at risk, were never warned.
 * Measured on prod 2026-10-05: cron.job 'expiring-jobs-push' = '14 14 * * *'.
 *
 * THE RULE. From the migrations (effective schedule: cron.schedule /
 * cron.unschedule plus ('name', 'schedule') tuples of a migration that calls
 * cron.alter_job; the same parse as cronStartsSpreadAcrossMinutes.test.ts):
 *   - it runs in every hour of the Louisiana day, 8am-8pm local in both CDT
 *     (13:00-01:00 UTC) and CST (14:00-02:00 UTC);
 *   - the longest gap between two runs is at most 12 hours, and the function's
 *     own look-ahead window is longer than that gap;
 *   - its liveness expectation (cron_work_expectations.expected_max_gap, newest
 *     migration row) is the longest gap rounded up to the hour, plus one hour:
 *     exact, so a loose 30h left from the daily schedule fails too.
 */
// @mutate supabase/migrations/20261005060246_expiring_jobs_push_hourly_daytime.sql | ('expiring-jobs-push', '14 13-23,0-2 * * *') | ('expiring-jobs-push', '14 14 * * *')
// @mutate supabase/migrations/20261005060246_expiring_jobs_push_hourly_daytime.sql | VALUES ('expiring-jobs-push', interval '12 hours', | VALUES ('expiring-jobs-push', interval '30 hours',
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const JOB = "expiring-jobs-push";
const files = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")));

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
  return [...out].sort((x, y) => x - y);
}

/** Minutes-of-day (UTC) the schedule starts on; day fields must be '*'. */
function startsPerDay(sched: string): number[] {
  const [m, h, dom, mon, dow] = sched.trim().split(/\s+/);
  expect([dom, mon, dow], `${JOB} must run every day`).toEqual(["*", "*", "*"]);
  return field(h, 0, 23).flatMap((hh) => field(m, 0, 59).map((mm) => hh * 60 + mm)).sort((a, b) => a - b);
}

function longestGapMinutes(starts: number[]): number {
  let gap = 0;
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? starts[i + 1] : starts[0] + 24 * 60;
    gap = Math.max(gap, next - starts[i]);
  }
  return gap;
}

/** expected_max_gap (hours) of the job's newest cron_work_expectations INSERT row. */
function expectedMaxGapHours(): number | null {
  let hours: number | null = null;
  for (const sql of files) {
    for (const block of sql.matchAll(/INSERT\s+INTO\s+public\.cron_work_expectations\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi)) {
      const cols = block[1].split(",").map((c) => c.trim().toLowerCase());
      const gapCol = cols.indexOf("expected_max_gap");
      if (gapCol < 0) continue;
      for (const row of block[2].matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        if (!new RegExp(`^\\s*'${JOB}'`).test(row[1])) continue;
        const iv = /interval\s*'(\d+)\s*hours?'/i.exec(row[1]);
        if (iv) hours = Number(iv[1]);
      }
    }
  }
  return hours;
}

describe("expiring-jobs-push warns a short-lead listing (Q994)", () => {
  const sched = schedules.get(JOB);

  it("the inventory is real: the migrations' schedules parse and include this job", () => {
    expect(schedules.size).toBeGreaterThan(50);
    expect(sched).toBeDefined();
  });

  it("it runs in every hour of the Louisiana day (8am-8pm, CDT and CST)", () => {
    const hours = new Set(startsPerDay(sched!).map((m) => Math.floor(m / 60)));
    const daytimeUtc = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2];
    expect(daytimeUtc.filter((h) => !hours.has(h))).toEqual([]);
  });

  it("the longest gap between runs is at most 12 hours and shorter than the look-ahead window", () => {
    const gap = longestGapMinutes(startsPerDay(sched!));
    expect(gap).toBeLessThanOrEqual(12 * 60);
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/expiring-jobs-push/index.ts"), "utf8"));
    const win = /now\.getTime\(\)\s*\+\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.exec(fn);
    expect(win, "look-ahead window not found").toBeTruthy();
    expect(Number(win![1]) * 60).toBeGreaterThan(gap);
  });

  it("its liveness expectation matches the schedule exactly (longest gap, rounded up, plus an hour)", () => {
    const gap = longestGapMinutes(startsPerDay(sched!));
    expect(expectedMaxGapHours()).toBe(Math.ceil(gap / 60) + 1);
  });
});
