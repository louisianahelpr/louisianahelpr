/**
 * CLASS GUARD: a long test step in a job that holds the shared prod accounts
 * stops BEFORE its job's cap, so the evidence after it survives.
 *
 * a11y-webkit-prod 37554737678 (2026-10-07, nightly-red #2375): the chromium
 * sweep step ran until GitHub cancelled the whole job at its 60-minute cap.
 * A job cancelled at its cap runs none of its `if: always()` steps (the
 * request budget, the report and screenshot upload) and GitHub keeps NO log
 * for it (the job-logs API answers BlobNotFound), so the run that most needed
 * a diagnosis left nothing to read. press-every-control's legs are worse: their
 * `if: always()` steps RESTORE the shared accounts.
 *
 * So, from the workflow files: in every job whose concurrency group is the
 * shared-account lock, every step that runs `playwright test` or
 * `press-wave.sh` declares a numeric step `timeout-minutes`, and those steps'
 * minutes sum to at most the job's cap minus HEADROOM. A step timeout fails
 * the step (not the job), and the later evidence and restore steps run.
 */
// @mutate .github/workflows/a11y-webkit-prod.yml |       - name: Run the prod sweep (chromium)\n        timeout-minutes: 52 |       - name: Run the prod sweep (chromium)
// @mutate .github/workflows/prod-audit.yml |         timeout-minutes: 150 |         timeout-minutes: 178
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const WF_DIR = resolve(__dirname, "../../.github/workflows");
const LOCK = "prod-lifecycle-shared-accounts";
const LONG = /playwright test|press-wave\.sh/;
/** Minutes left after the long steps for upload, budget and restore steps. */
const HEADROOM = 3;

type Step = { name?: string; run?: unknown; "timeout-minutes"?: unknown };
type Job = { "timeout-minutes"?: unknown; concurrency?: string | { group?: string }; steps?: Step[] };

function lockedLongSteps() {
  const out: { job: string; cap: unknown; steps: { name: string; minutes: unknown }[] }[] = [];
  for (const file of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const jobs = ((parse(readFileSync(join(WF_DIR, file), "utf8")) as { jobs?: Record<string, Job> })?.jobs) ?? {};
    for (const [key, job] of Object.entries(jobs)) {
      const group = typeof job.concurrency === "string" ? job.concurrency : job.concurrency?.group;
      if (group !== LOCK) continue;
      const steps = (job.steps ?? [])
        .filter((s) => typeof s.run === "string" && LONG.test(s.run))
        .map((s) => ({ name: s.name ?? String(s.run).slice(0, 60), minutes: s["timeout-minutes"] }));
      if (steps.length) out.push({ job: `${file}:${key}`, cap: job["timeout-minutes"], steps });
    }
  }
  return out;
}

describe("long steps under the shared-account lock stop before their job's cap", () => {
  const jobs = lockedLongSteps();

  it("finds the locked test jobs (floor)", () => {
    // 19 jobs on 2026-10-07: a11y x3, abuse, journeys x2, real-backend x3, press x6, privacy, prod-audit, slow-network.
    expect(jobs.length).toBeGreaterThan(15);
  });

  it("every long step has its own numeric timeout, summing to the cap minus headroom", () => {
    const wrong: string[] = [];
    for (const j of jobs) {
      if (typeof j.cap !== "number") {
        wrong.push(`${j.job}: no numeric job timeout-minutes`);
        continue;
      }
      let sum = 0;
      for (const s of j.steps) {
        if (typeof s.minutes !== "number") wrong.push(`${j.job} "${s.name}": no step timeout-minutes (a job cancelled at its cap keeps no log and runs no if: always() step)`);
        else sum += s.minutes;
      }
      if (sum > j.cap - HEADROOM) wrong.push(`${j.job}: long steps sum to ${sum} min, over the job cap ${j.cap} minus ${HEADROOM}`);
    }
    expect(wrong).toEqual([]);
  });
});
