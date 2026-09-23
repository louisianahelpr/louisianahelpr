// @mutate scripts/ci/cancelled-prod-load-runs.mjs | r.conclusion === "cancelled" | r.conclusion === "failure"
// @mutate .github/workflows/schedule-heartbeat.yml | STALE_COUNT=$((STALE_COUNT + CANCELLED)) | STALE_COUNT=$((STALE_COUNT + 0))
// @mutate .github/workflows/schedule-heartbeat.yml | node scripts/ci/cancelled-prod-load-runs.mjs > /tmp/cancelled.txt | echo cancelled=0 > /tmp/cancelled.txt
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   return group === "prod-load" \|\| /'prod-load'/.test(group); |   return group === "prod-load";
// @mutate .github/workflows/privacy-journey.yml | status: ${{ needs.gate.result == 'success' && needs.privacy-journey.result == 'success' && 'success' \|\| 'failure' }} | status: ${{ needs.gate.result != 'failure' && needs.privacy-journey.result != 'failure' && 'success' \|\| 'failure' }}
// @mutate .github/workflows/db-backup.yml |     if: always() && (github.event_name == 'schedule' | |     if: success() \|\| failure() && (github.event_name == 'schedule' |
/*
 * CLASS GUARD (docs/OPEN.md Q293): a scheduled prod-load run that was
 * CANCELLED is reported as red, never silently lost.
 *
 * Two ways a prod-load run can be cancelled, two layers:
 *
 *  1. JOB level (a timeout, a manual cancel mid-run). The run's `notify` job
 *     still runs, so its nightly-issue-sync status must turn a `cancelled`
 *     need into 'failure': run only on `always()`, and compare every need
 *     with `== 'success'` (a `!= 'failure'` test reads cancelled as green).
 *  2. WORKFLOW level. GitHub keeps one PENDING run per concurrency group; a
 *     third run entering `prod-load` cancels the waiting one before any job
 *     starts, notify included. Nothing in the run can report that, so
 *     schedule-heartbeat.yml runs scripts/ci/cancelled-prod-load-runs.mjs
 *     daily and counts every cancelled scheduled prod-load run (8-day window)
 *     as stalled: schedule-stalled issue + red heartbeat.
 *
 * The workflow set is derived from the files (workflow-level group that can
 * be 'prod-load' + a schedule), never a hand list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import * as cancelled from "../../scripts/ci/cancelled-prod-load-runs.mjs";

const ROOT = resolve(__dirname, "../..");
const prodLoadWorkflows = cancelled.prodLoadWorkflows as (dir?: string) => string[];
const cancelledScheduledRuns = cancelled.cancelledScheduledRuns as (runs: Record<string, unknown>[], o?: { now?: number; windowDays?: number }) => Record<string, unknown>[];
const WINDOW_DAYS = cancelled.WINDOW_DAYS as number;
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

  it("counts a cancelled SCHEDULED run inside the window, and nothing else", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    const run = (o: Record<string, unknown>) => ({ event: "schedule", status: "completed", conclusion: "cancelled", created_at: "2026-09-21T03:17:00Z", ...o });
    expect(cancelledScheduledRuns([run({})], { now })).toHaveLength(1);
    expect(cancelledScheduledRuns([run({ conclusion: "success" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ conclusion: "failure" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ event: "workflow_dispatch" })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ status: "in_progress", conclusion: null })], { now })).toHaveLength(0);
    expect(cancelledScheduledRuns([run({ created_at: new Date(now - (WINDOW_DAYS + 1) * 86_400_000).toISOString() })], { now })).toHaveLength(0);
    // A weekly workflow's cancelled run is still in the window at the next daily heartbeat.
    expect(WINDOW_DAYS).toBeGreaterThanOrEqual(8);
  });

  it("schedule-heartbeat runs the check and adds every cancelled run to its stalled count", () => {
    const wf = read(".github/workflows/schedule-heartbeat.yml");
    const i = wf.indexOf("node scripts/ci/cancelled-prod-load-runs.mjs > /tmp/cancelled.txt");
    expect(i).toBeGreaterThan(0);
    const tail = wf.slice(i, wf.indexOf('echo "stale=$STALE_COUNT"', i));
    expect(tail).toContain("CANCELLED=$(sed -n 's/^cancelled=//p' /tmp/cancelled.txt)");
    expect(tail).toContain("STALE_COUNT=$((STALE_COUNT + CANCELLED))");
    expect(wf).toMatch(/set -eo pipefail/);
  });

  it("every prod-load notify runs on always() and turns a cancelled need into 'failure'", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of files) {
      const wf = parse(read(`.github/workflows/${f}`)) as { jobs: Record<string, Job> };
      for (const [name, job] of Object.entries(wf.jobs)) {
        const sync = (job.steps ?? []).find((s) => s.uses === "./.github/actions/nightly-issue-sync");
        if (!sync) continue;
        checked++;
        const where = `${f} ${name}`;
        const cond = job.if ?? "";
        if (!/\balways\(\)/.test(cond)) bad.push(`${where}: if: must include always() (got "${cond}")`);
        if (/cancelled\(\)|!= 'cancelled'|== 'cancelled'/.test(cond)) bad.push(`${where}: if: excludes cancelled runs`);
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
