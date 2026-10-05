/**
 * Q432 (second half): vacuity's prod-backed Playwright registrations wait for
 * the pushed commit's own deploys, so they never test the old backend.
 *
 * Vacuity run 36215687625 (2026-09-26, read fixing Q433): both
 * privacy-requests.spec.ts registrations were "RED before any mutation" while
 * functions-deploy 36215687560, started by the same push, was still deploying.
 * scripts/ci/wait-commit-deploys.mjs now holds vacuity-e2e on a push until
 * that commit's db-deploy and functions-deploy runs are done (bounded, never
 * failing the job), and says so when one of them failed.
 *
 * @mutate scripts/ci/wait-commit-deploys.mjs |   if (inFlight.length) { |   if (false) {
 * @mutate scripts/ci/wait-commit-deploys.mjs |   const bad = runs.filter((r) => r.conclusion !== "success" && r.conclusion !== "skipped"); |   const bad = [];
 * @mutate .github/workflows/vacuity.yml |         run: node scripts/ci/wait-commit-deploys.mjs\n |         run: echo skipped\n
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import { DEPLOY_WORKFLOWS, deployWaitDecision } from "../../scripts/ci/wait-commit-deploys.mjs";

const ROOT = join(__dirname, "..", "..");

describe("vacuity's prod-backed registrations wait for the commit's deploys (Q432)", () => {
  it("waits while a deploy of this commit is in flight, then goes", () => {
    expect(deployWaitDecision([]).action).toBe("go");
    expect(deployWaitDecision([{ name: "Supabase DB Deploy", status: "in_progress" }]).action).toBe("wait");
    expect(deployWaitDecision([{ name: "a", status: "queued" }, { name: "b", status: "completed", conclusion: "success" }]).action).toBe("wait");
    const done = deployWaitDecision([{ name: "a", status: "completed", conclusion: "success" }]);
    expect(done).toMatchObject({ action: "go", warn: [] });
  });

  it("a deploy of this commit that failed is said out loud", () => {
    const d = deployWaitDecision([{ name: "Supabase Edge Functions Deploy", status: "completed", conclusion: "failure", html_url: "u" }]);
    expect(d.action).toBe("go");
    expect(d.warn.join("\n")).toMatch(/Supabase Edge Functions Deploy ended failure/);
  });

  it("the deploy workflows it reads exist", () => {
    expect(DEPLOY_WORKFLOWS.length).toBeGreaterThan(1);
    for (const wf of DEPLOY_WORKFLOWS) expect(existsSync(join(ROOT, ".github", "workflows", wf)), wf).toBe(true);
  });

  it("vacuity-e2e runs the wait on a push, before the gate, with actions: read", () => {
    const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "vacuity.yml"), "utf8"));
    const job = wf.jobs["vacuity-e2e"];
    expect(job.permissions).toMatchObject({ actions: "read" });
    const steps = job.steps as { name?: string; run?: string; if?: string }[];
    const wait = steps.findIndex((s) => s.run === "node scripts/ci/wait-commit-deploys.mjs");
    const gate = steps.findIndex((s) => s.name === "Vacuity gate (Playwright registrations)");
    expect(wait).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(wait);
    expect(steps[wait].if).toBe("github.event_name == 'push'");
  });
});
