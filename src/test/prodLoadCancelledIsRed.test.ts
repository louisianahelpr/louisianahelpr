// @mutate scripts/ci/cancelled-prod-load-runs.mjs | r.conclusion === "cancelled" | r.conclusion === "failure"
// @mutate .github/workflows/schedule-heartbeat.yml | STALE_COUNT=$((STALE_COUNT + CANCELLED)) | STALE_COUNT=$((STALE_COUNT + 0))
// @mutate .github/workflows/schedule-heartbeat.yml | node scripts/ci/cancelled-prod-load-runs.mjs > /tmp/cancelled.txt | echo cancelled=0 > /tmp/cancelled.txt
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   return group === "prod-load" \|\| /'prod-load'/.test(group); |   return group === "prod-load";
// @mutate .github/workflows/privacy-journey.yml | status: ${{ needs.gate.result == 'success' && needs.privacy-journey.result == 'success' && 'success' \|\| 'failure' }} | status: ${{ needs.gate.result != 'failure' && needs.privacy-journey.result != 'failure' && 'success' \|\| 'failure' }}
/*
 * CLASS GUARD (docs/OPEN.md Q293): a scheduled prod-load run that was
 * CANCELLED is reported as red, never silently lost.
 *
 * Two ways a prod-load run can be cancelled, two layers:
 *
 * One layer reports it: schedule-heartbeat.yml runs
 * scripts/ci/cancelled-prod-load-runs.mjs daily and counts every cancelled
 * scheduled prod-load run (8-day window) as stalled: schedule-stalled issue
 * + red heartbeat. That covers both ways a run is cancelled:
 *  - PENDING: GitHub keeps one pending run per concurrency group; a third run
 *    entering `prod-load` cancels the waiting one before any job starts,
 *    notify included, so nothing in the run can report it.
 *  - MID-RUN (a manual cancel): notify jobs are on `!cancelled()` since Q821
 *    (nightlyReportersSkipCancelledRuns.test.ts) so a cancelled run never
 *    files a red it did not test; the heartbeat is what reports it instead.
 * A job's own timeout does not cancel the run, so notify still runs then, and
 * its status must compare every need with `== 'success'` (a `!= 'failure'`
 * test would read a skipped or cancelled need as green).
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
