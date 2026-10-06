// @mutate scripts/ci/cancelled-prod-load-runs.mjs |       if (!fx.error && reportedItsOwnRed(fx.jobs, fx.annotations, reporters)) { |       if (false) {
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (!jobs.some((j) => reporters.has(j.name) && j.conclusion === "success")) return false; |   if (false) return false;
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (checks.some((j) => j.conclusion === "cancelled" && !Array.isArray(annotations?.[j.id]))) return false; |   if (false) return false;
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   return classifyJobs(checks, annotations).failed.length > 0; |   return true;
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |     if (!/uses:\s*["']?\.\/\.github\/actions\/nightly-issue-sync["']?\s*$/m.test(code)) return; |     return;
/*
 * A SCHEDULED RUN THAT TIMED OUT REPORTED ITSELF (#2464 / #2465, 2026-10-06).
 *
 * a11y-webkit-prod's scheduled run 37355527038 (2026-10-05) has RUN conclusion
 * `cancelled`: its "Sweep prod (chromium + webkit)" job hit its own 60-minute
 * timeout-minutes (annotation "The job has exceeded the maximum execution time
 * of 1h0m0s"; the jobs API calls that job `cancelled`). Its "Report nightly
 * result" job still ran and filed the red as "Still red" on #2375. Yet
 * scripts/ci/cancelled-prod-load-runs.mjs counted every cancelled scheduled run
 * as "cancelled, nothing reported", so schedule-heartbeat opened
 * schedule-stalled #2464 and went red itself (#2465): three alerts for one red.
 *
 * The class: the heartbeat must judge a cancelled run the way
 * nightly-issue-sync does (scripts/ci/run-verdict.mjs classifyJobs: a timeout
 * or a failed step is a FAILURE, not a cancel). A run whose checks failed or
 * timed out AND whose reporting job (a job using nightly-issue-sync,
 * reporterJobNames) concluded success reported itself and is not a loss. A
 * bare cancel (by hand, by a concurrency group) still is, and so is a run
 * whose annotations could not be read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as cancelled from "../../scripts/ci/cancelled-prod-load-runs.mjs";

const ROOT = resolve(__dirname, "../..");
const WF = resolve(ROOT, ".github/workflows");
type Job = { id: number; name: string; conclusion: string; steps?: { conclusion: string }[] };
const reporterJobNames = cancelled.reporterJobNames as (src: string) => Set<string>;
const reportedItsOwnRed = cancelled.reportedItsOwnRed as (jobs: Job[], annotations: Record<number, { message: string }[]>, reporters: Set<string>) => boolean;

// Measured: gh api repos/louisianahelpr/louisianahelpr/actions/runs/37355527038/jobs (2026-10-06).
const RUN_37355527038: Job[] = [
  { id: 112032495200, name: "Wait for the prod-load queue (first in, first served)", conclusion: "success" },
  { id: 112032495266, name: "Wait for the shared accounts (queue)", conclusion: "success" },
  { id: 112032495733, name: "Sweep prod (chromium + webkit)", conclusion: "cancelled", steps: [{ conclusion: "failure" }, { conclusion: "cancelled" }] },
  { id: 112032495798, name: "Job-status fixtures", conclusion: "success" },
  { id: 112032543334, name: "What can run", conclusion: "success" },
  { id: 112057923084, name: "WebKit-only violations", conclusion: "failure" },
  { id: 112057999019, name: "Report nightly result", conclusion: "success" },
];
const TIMEOUT = { 112032495733: [{ message: "The job has exceeded the maximum execution time of 1h0m0s" }, { message: "The operation was canceled." }] };

describe("schedule-heartbeat: a timed-out scheduled run that filed its own red is not a lost run", () => {
  const files = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));
  const a11y = reporterJobNames(readFileSync(resolve(WF, "a11y-webkit-prod.yml"), "utf8"));

  it("derives every scheduled workflow's reporting job from its file", () => {
    expect([...a11y]).toEqual(["Report nightly result"]);
    // Floor: every workflow that uses nightly-issue-sync has a reporting job the parser finds.
    const users = files.filter((f) => /uses:\s*\.\/\.github\/actions\/nightly-issue-sync\s*$/m.test(readFileSync(resolve(WF, f), "utf8")));
    expect(users.length).toBeGreaterThan(30);
    for (const f of users) expect(reporterJobNames(readFileSync(resolve(WF, f), "utf8")).size, f).toBeGreaterThan(0);
  });

  it("the live run: a 60-minute timeout whose notify filed #2375 reported itself", () => {
    expect(reportedItsOwnRed(RUN_37355527038, TIMEOUT, a11y)).toBe(true);
  });

  it("a bare cancel is still a loss: by hand, notify skipped, or annotations unread", () => {
    // By hand mid-run: the notify job is skipped on !cancelled().
    const byHand = RUN_37355527038.map((j) => (j.name === "Report nightly result" ? { ...j, conclusion: "skipped" } : j.name === "WebKit-only violations" ? { ...j, conclusion: "skipped" } : j));
    expect(reportedItsOwnRed(byHand, { 112032495733: [{ message: "The run was canceled by @louisianahelpr." }] }, a11y)).toBe(false);
    // Notify ran but every check was only cancelled (a runner never picked it up): no red to report.
    const infra = [
      { id: 1, name: "Sweep prod (chromium + webkit)", conclusion: "cancelled", steps: [] },
      { id: 2, name: "Report nightly result", conclusion: "success" },
    ];
    expect(reportedItsOwnRed(infra, { 1: [{ message: "The job was not acquired by Runner of type hosted even after multiple attempts" }] }, a11y)).toBe(false);
    // Annotations of the cancelled job unread: fail closed (stays red on the heartbeat).
    expect(reportedItsOwnRed(RUN_37355527038.filter((j) => j.name !== "WebKit-only violations"), {}, a11y)).toBe(false);
    // No job at all (lost the pending slot): nothing reported.
    expect(reportedItsOwnRed([], {}, a11y)).toBe(false);
  });

  it("the detector partitions on it before counting or re-dispatching", () => {
    const src = readFileSync(resolve(ROOT, "scripts/ci/cancelled-prod-load-runs.mjs"), "utf8");
    const i = src.indexOf("reportedItsOwnRed(fx.jobs, fx.annotations, reporters)");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf("redispatchPlan(f, stalled, runs"));
  });
});
