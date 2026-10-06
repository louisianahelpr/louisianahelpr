// @mutate scripts/ci/cancelled-prod-load-runs.mjs | r.conclusion === "cancelled" | r.conclusion === "failure"
// @mutate .github/workflows/schedule-heartbeat.yml | STALE_COUNT=$((STALE_COUNT + CANCELLED)) | STALE_COUNT=$((STALE_COUNT + 0))
// @mutate .github/workflows/schedule-heartbeat.yml | node scripts/ci/cancelled-prod-load-runs.mjs --redispatch > /tmp/cancelled.txt | echo cancelled=0 > /tmp/cancelled.txt
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   return group === "prod-load" \|\| /'prod-load'/.test(group); |   return group === "prod-load";
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   return COVERING_EVENTS.has(o.event) && !String(o.display_title ?? "").includes("(main batch "); |   return COVERING_EVENTS.has(o.event);
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (later.some((o) => IN_FLIGHT.has(o.status))) return "recovering"; |   if (false) return "recovering";
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (!open.length) return sched; |   return sched;
// @mutate scripts/ci/cancelled-prod-load-runs.mjs | l.includes("node scripts/ci/wait-prod-load.mjs")); | l.includes("node scripts/ci/wait-prod-load-X.mjs"));
// @mutate scripts/ci/cancelled-prod-load-runs.mjs | files: scheduledWorkflows(dir), | files: [...prodLoadWorkflows(dir)],
// @mutate scripts/ci/cancelled-prod-load-runs.mjs | Date.parse(r.created_at) <= now - graceMs && | true &&
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |     return !/^\d+$/.test(min) \|\| !/^\d+$/.test(hour); |     return false;
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (!prodLoad) return { act: false, | if (false) return { act: false,
// @mutate .github/workflows/privacy-journey.yml | status: ${{ needs.gate.result == 'success' && needs.privacy-journey.result == 'success' && 'success' \|\| 'failure' }} | status: ${{ needs.gate.result != 'failure' && needs.privacy-journey.result != 'failure' && 'success' \|\| 'failure' }}
/*
 * CLASS GUARD (docs/OPEN.md Q293): a scheduled prod-load run that was
 * CANCELLED is reported as red, never silently lost.
 *
 * Two ways a prod-load run can be cancelled, two layers:
 *
 * schedule-redispatch.yml re-dispatches every such run once, the moment it
 * is cancelled (cancelledScheduleIsRedispatched.test.ts). The backstop reports
 * whatever that did not cover: schedule-heartbeat.yml runs
 * scripts/ci/cancelled-prod-load-runs.mjs daily and counts every cancelled
 * scheduled prod-load run (8-day window) that no later FULL run re-tested as
 * stalled: schedule-stalled issue + red heartbeat. A re-test still in flight
 * is shown as recovering, not counted. That covers both ways a run is cancelled:
 *  - PENDING: GitHub keeps one pending run per concurrency group; a third run
 *    entering `prod-load` cancels the waiting one before any job starts,
 *    notify included, so nothing in the run can report it.
 *  - MID-RUN (a manual cancel): notify jobs are on `!cancelled()` since Q821
 *    (nightlyReportersSkipCancelledRuns.test.ts) so a cancelled run never
 *    files a red it did not test; the heartbeat is what reports it instead.
 * A job's own timeout DOES give the run conclusion `cancelled` (a11y-webkit-prod
 * 37355527038, 2026-10-05), but notify still runs then (only a job was
 * cancelled), and its status must compare every need with `== 'success'` (a
 * `!= 'failure'` test would read a skipped or cancelled need as green). Such a
 * run reported itself and is not counted as lost:
 * heartbeatTimedOutRunReportedItself.test.ts.
 *
 * The workflow set is derived from the files (workflow-level group that can
 * be 'prod-load' + a schedule), never a hand list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import * as cancelled from "../../scripts/ci/cancelled-prod-load-runs.mjs";

const ROOT = resolve(__dirname, "../..");
type Run = Record<string, unknown>;
const prodLoadWorkflows = cancelled.prodLoadWorkflows as (dir?: string) => string[];
const cancelledScheduledRuns = cancelled.cancelledScheduledRuns as (runs: Run[], o?: { now?: number; windowDays?: number; file?: string; graceMs?: number }) => Run[];
const recoveringScheduledRuns = cancelled.recoveringScheduledRuns as (runs: Run[], o?: { now?: number; windowDays?: number }) => Run[];
const cancelCause = cancelled.cancelCause as (jobs: unknown[], annotations?: { message: string }[], o?: { prodLoad?: boolean }) => string;
const workflowRuns = cancelled.workflowRuns as (repo: string, file: string, o: { now: number; runs: (path: string) => Run[] }) => Run[];
const WINDOW_DAYS = cancelled.WINDOW_DAYS as number;
const isProdLoadGroup = cancelled.isProdLoadGroup as (group: string | null) => boolean;
const runsProdLoadQueue = cancelled.runsProdLoadQueue as (src: string) => boolean;
const SUB_DAILY_GRACE_MS = cancelled.SUB_DAILY_GRACE_MS as number;
const scanTargets = cancelled.scanTargets as (dir?: string) => { files: string[]; prodLoad: Set<string> };
const firesMoreThanDaily = cancelled.firesMoreThanDaily as (src: string) => boolean;
const redispatchPlan = cancelled.redispatchPlan as (file: string, stalled: Run[], runs: Run[], o?: { prodLoad?: boolean }) => { act: boolean; why: string };
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

type Step = { uses?: string; with?: Record<string, string> };
type Job = { if?: string; needs?: string | string[]; steps?: Step[] };

describe("Q293: a cancelled scheduled prod-load run is red", () => {
  const files = prodLoadWorkflows(resolve(ROOT, ".github/workflows"));

  it("derives the prod-load workflow set from the files", () => {
    expect(files.length).toBeGreaterThan(15);
    // Both shapes of group: the literal, and the schedule-only expression.
    expect(files).toContain("press-every-control.yml");
    expect(files).toContain("privacy-journey.yml");
  });

  it("a workflow is in prod-load by its queue job (Q1161) or by the legacy shared group, in either shape", () => {
    // Both shapes of the legacy group: the literal, and the schedule-only expression.
    expect(isProdLoadGroup("prod-load")).toBe(true);
    expect(isProdLoadGroup("${{ github.event_name == 'schedule' && 'prod-load' || format('x-{0}', github.run_id) }}")).toBe(true);
    expect(isProdLoadGroup("${{ format('x-{0}', github.run_id) }}")).toBe(false);
    expect(isProdLoadGroup(null)).toBe(false);
    expect(runsProdLoadQueue("jobs:\n  prod-load-turn:\n    steps:\n      - run: node scripts/ci/wait-prod-load.mjs\n")).toBe(true);
    expect(runsProdLoadQueue("jobs:\n  a:\n    steps:\n      # - run: node scripts/ci/wait-prod-load.mjs\n      - run: npm test\n")).toBe(false);
  });

  it("counts a cancelled SCHEDULED run inside the window, and nothing else", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    const run = (o: Record<string, unknown>) => ({ event: "schedule", status: "completed", conclusion: "cancelled", created_at: "2026-09-21T03:17:00Z", ...o });
    expect(cancelledScheduledRuns([run({})], { now })).toHaveLength(1);
    expect(cancelledScheduledRuns([run({ conclusion: "success" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ conclusion: "failure" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ event: "workflow_dispatch" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ status: "in_progress", conclusion: null })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ created_at: new Date(now - (WINDOW_DAYS + 1) * 86_400_000).toISOString() })], { now })).toHaveLength(0);
    // A later completed run (scheduled or dispatched, green or red) covers it; a later cancel or a push run does not.
    const later = (o: Record<string, unknown>) => ({ event: "schedule", status: "completed", conclusion: "success", created_at: "2026-09-22T03:17:00Z", ...o });
    expect(cancelledScheduledRuns([run({}), later({})], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({}), later({ conclusion: "failure" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({}), later({ event: "workflow_dispatch" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({}), later({ conclusion: "cancelled" })], { now })).toHaveLength(2);
    expect(cancelledScheduledRuns([run({}), later({ event: "push" })], { now })).toHaveLength(1);
    expect(cancelledScheduledRuns([run({}), later({ created_at: "2026-09-20T03:17:00Z" })], { now })).toHaveLength(1);
    // A later run still in flight (schedule-redispatch.yml's re-dispatch, usually)
    // is RECOVERING: not counted, shown, and judged again by the next heartbeat.
    const inFlight = later({ event: "workflow_dispatch", status: "in_progress", conclusion: null });
    expect(cancelledScheduledRuns([run({}), inFlight], { now })).toHaveLength(0);
    expect(recoveringScheduledRuns([run({}), inFlight], { now })).toHaveLength(1);
    expect(recoveringScheduledRuns([run({}), later({})], { now })).toHaveLength(0);
    // A main-batch dispatch skips every scheduled job: it covers nothing, done or not.
    const batch = { display_title: "E2E real backend (main batch 3c80b47ac3a5)", event: "workflow_dispatch" };
    expect(cancelledScheduledRuns([run({}), later(batch)], { now })).toHaveLength(1);
    expect(cancelledScheduledRuns([run({}), later({ ...batch, status: "in_progress", conclusion: null })], { now })).toHaveLength(1);
    // A weekly workflow's cancelled run is still in the window at the next daily heartbeat.
    expect(WINDOW_DAYS).toBeGreaterThanOrEqual(8);
  });

  it("reads scheduled runs on their own, and dispatches only to judge a cancelled one", () => {
    // 2026-10-03: e2e-real-backend's 50 newest runs on main spanned 34 hours
    // (39 main-batch dispatches), so one mixed page hid most of the window.
    const now = Date.parse("2026-10-03T16:00:00Z");
    const calls: string[] = [];
    const sched = [{ id: 1, event: "schedule", status: "completed", conclusion: "cancelled", created_at: "2026-10-03T14:18:55Z" }];
    const dispatched = [{ id: 2, event: "workflow_dispatch", status: "completed", conclusion: "success", created_at: "2026-10-03T15:30:00Z" }];
    const runs = (path: string) => (calls.push(path), path.includes("event=schedule") ? sched : dispatched);
    const got = workflowRuns("o/r", "write-contract-refresh.yml", { now, runs });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/event=schedule&per_page=100&created=%3E%3D/);
    expect(calls[1]).toMatch(/event=workflow_dispatch&per_page=100&created=%3E%3D2026-10-03T14%3A18%3A55Z/);
    expect(cancelledScheduledRuns(got, { now })).toHaveLength(0);
    // Nothing cancelled: one read.
    calls.length = 0;
    workflowRuns("o/r", "x.yml", { now, runs: (p: string) => (calls.push(p), []) });
    expect(calls).toHaveLength(1);
  });

  it("says why a run was cancelled: lost the pending slot, or a person (#2196's two rows)", () => {
    // write-contract-refresh 37129164563: no job at all.
    expect(cancelCause([], [])).toMatch(/no job ever started/);
    // expiry-monitor 37082255950: its job sat queued, then a bulk cancel took it.
    expect(cancelCause([{ id: 111085124328 }, { id: 111090166314 }], [{ message: "The run was canceled by @louisianahelpr." }])).toBe(
      "cancelled by hand (@louisianahelpr) with 2 job(s) created",
    );
    expect(cancelCause([{ id: 1 }], [{ message: "Canceling since a higher priority waiting request for prod-lifecycle-shared-accounts exists" }])).toMatch(/pending slot/);
  });

  it("schedule-heartbeat runs the check and adds every cancelled run to its stalled count", () => {
    const wf = read(".github/workflows/schedule-heartbeat.yml");
    const i = wf.indexOf("node scripts/ci/cancelled-prod-load-runs.mjs --redispatch > /tmp/cancelled.txt");
    expect(i).toBeGreaterThan(0);
    const tail = wf.slice(i, wf.indexOf('echo "stale=$STALE_COUNT"', i));
    expect(tail).toContain("CANCELLED=$(sed -n 's/^cancelled=//p' /tmp/cancelled.txt)");
    expect(tail).toContain("STALE_COUNT=$((STALE_COUNT + CANCELLED))");
    expect(wf).toMatch(/set -eo pipefail/);
  });

  it("every prod-load notify status turns any need that is not 'success' into 'failure'", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of files) {
      const wf = parse(read(`.github/workflows/${f}`)) as { jobs: Record<string, Job> };
      for (const [name, job] of Object.entries(wf.jobs)) {
        const sync = (job.steps ?? []).find((s) => s.uses === "./.github/actions/nightly-issue-sync");
        if (!sync) continue;
        checked++;
        const where = `${f} ${name}`;
        const status = sync.with?.status ?? "";
        const needs = [job.needs ?? []].flat();
        const compared = [...status.matchAll(/needs\.([\w-]+)\.result\s*(==|!=)\s*'(\w+)'/g)];
        if (!compared.length) continue; // a probe-output status (uptime) has no needs to cancel
        for (const [, need, op, value] of compared) {
          if (op !== "==" || value !== "success") bad.push(`${where}: status compares needs.${need}.result ${op} '${value}' (a cancelled need must read as failure)`);
          if (!needs.includes(need)) bad.push(`${where}: status reads needs.${need}, which is not in needs:`);
        }
        if (!/&& 'success' \|\| 'failure' \}\}$/.test(status.trim())) bad.push(`${where}: status must end "&& 'success' || 'failure' }}" (got ${status})`);
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(bad.join("\n"), "a cancelled prod-load run would report green or nothing").toBe("");
  });
});

describe("Q1162: a cancelled scheduled run of a check OUTSIDE prod-load is seen too", () => {
  const dir = resolve(ROOT, ".github/workflows");
  const { files, prodLoad } = scanTargets(dir);

  it("scans every workflow with a schedule: trigger, derived from the files", () => {
    const scheduled = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => {
        const on = (parse(read(`.github/workflows/${f}`)) as { on?: Record<string, unknown>; true?: Record<string, unknown> }).on ?? {};
        return typeof on === "object" && "schedule" in on;
      })
      .sort();
    expect(files).toEqual(scheduled);
    expect(files.length).toBeGreaterThan(35);
    // The three #2196 named, none of which holds the prod-load group, and a prod-load one.
    for (const f of ["staleness-watch.yml", "lighthouse.yml", "ui-sweep.yml", "expiry-monitor.yml"]) expect(files).toContain(f);
    for (const f of ["staleness-watch.yml", "lighthouse.yml", "ui-sweep.yml"]) expect(prodLoad.has(f), `${f} is outside prod-load`).toBe(false);
    for (const f of prodLoad) expect(files).toContain(f);
  });

  it("a cancelled run of a daily-or-rarer check outside prod-load is stalled until a later run covers it", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const run = (o: Run) => ({ event: "schedule", status: "completed", conclusion: "cancelled", created_at: "2026-10-03T09:17:00Z", ...o });
    expect(cancelledScheduledRuns([run({})], { now, file: "staleness-watch.yml" })).toHaveLength(1);
    expect(cancelledScheduledRuns([run({}), run({ conclusion: "success", created_at: "2026-10-04T09:17:00Z" })], { now, file: "staleness-watch.yml" })).toHaveLength(0);
  });

  it("a more-than-daily workflow covers itself: its fresh cancelled run waits SUB_DAILY_GRACE_MS before it counts", () => {
    const sub = (cron: string) => `on:\n  schedule:\n    - cron: "${cron}"\n`;
    for (const cron of ["*/10 * * * *", "47 * * * *", "17 */6 * * *", "0,30 5 * * *"]) expect(firesMoreThanDaily(sub(cron)), cron).toBe(true);
    for (const cron of ["17 9 * * 0,2,6", "17 5 * * 2,5", "0 5 * * 3", "23 11 * * *"]) expect(firesMoreThanDaily(sub(cron)), cron).toBe(false);
    expect(firesMoreThanDaily(`on:\n  schedule:\n    # - cron: "*/5 * * * *"\n    - cron: "17 9 * * *"\n`)).toBe(false);
    for (const f of ["uptime.yml", "core-loop-canary.yml", "prod-errors.yml", "main-batch.yml", "prod-deploy.yml", "branch-prune.yml"]) expect(firesMoreThanDaily(read(`.github/workflows/${f}`)), f).toBe(true);
    for (const f of ["staleness-watch.yml", "lighthouse.yml", "ui-sweep.yml", "e2e-journeys.yml"]) expect(firesMoreThanDaily(read(`.github/workflows/${f}`)), f).toBe(false);

    const now = Date.parse("2026-10-04T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
    const run = (h: number) => ({ event: "schedule", status: "completed", conclusion: "cancelled", created_at: hoursAgo(h) });
    expect(cancelledScheduledRuns([run(1)], { now, graceMs: SUB_DAILY_GRACE_MS })).toHaveLength(0);
    expect(cancelledScheduledRuns([run(25)], { now, graceMs: SUB_DAILY_GRACE_MS })).toHaveLength(1);
    expect(cancelledScheduledRuns([run(1)], { now })).toHaveLength(1);
  });

  it("outside prod-load a stalled run is reported, not re-dispatched; inside it still is", () => {
    const stalled = [{ id: 1, event: "schedule", status: "completed", conclusion: "cancelled", created_at: "2026-10-03T09:17:00Z" }];
    const outside = redispatchPlan("staleness-watch.yml", stalled, stalled, { prodLoad: false });
    expect(outside.act).toBe(false);
    expect(outside.why).toMatch(/reported, not re-dispatched/);
    expect(redispatchPlan("write-contract-refresh.yml", stalled, stalled, { prodLoad: true }).act).toBe(true);
    expect(cancelCause([], [], { prodLoad: false })).not.toMatch(/prod-load/);
  });
});
