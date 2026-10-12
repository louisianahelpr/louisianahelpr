// @mutate .github/workflows/dependabot-auto-merge.yml | branches: ["dependabot/**"] | # branches removed
// @mutate .github/workflows/main-red-watch.yml | branches: [main] | # branches removed
/*
 * CLASS GUARD (Q1686, docs/OPEN.md): a `workflow_run` trigger without a
 * `branches:` filter starts a run, and queues a runner job, for EVERY
 * completed run of the workflows it watches, on every PR branch. When the job
 * only acts on a few branches (dependabot's, or main), the rest are runner
 * jobs that start, read the event and exit.
 *
 * MEASURED 2026-10-12 10:25Z: 298 runs queued with about 10 jobs running;
 * 34 of the queued runs were "Dependabot auto-merge" runs for non-dependabot
 * PR branches, each waiting for a runner only to print "not dependabot[bot]".
 * The filter at the trigger means GitHub never creates those runs.
 *
 * Every workflow_run-triggered workflow must name its branches. A workflow
 * that genuinely needs every branch is listed below with its reason; the list
 * is exact (a listed workflow that gains a filter, or leaves workflow_run,
 * fails it too).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const WF_DIR = join(resolve(__dirname, "../.."), ".github/workflows");

/** Workflows whose workflow_run trigger must see every branch, and why. */
const ALL_BRANCHES: Record<string, string> = {
  // Advances the land queue when a required check finishes on any PR head.
  "land-queue.yml": "a required check finishing on ANY PR branch can move the queue",
};

type WorkflowRun = { workflows?: string[]; branches?: string[]; "branches-ignore"?: string[] };

function workflowRunTriggers(): Map<string, WorkflowRun> {
  const out = new Map<string, WorkflowRun>();
  for (const file of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const doc = parse(readFileSync(join(WF_DIR, file), "utf8")) as Record<string, unknown> | null;
    const on = (doc?.on ?? doc?.["true"]) as Record<string, unknown> | string | string[] | undefined;
    if (!on) continue;
    if (on === "workflow_run" || (Array.isArray(on) && on.includes("workflow_run"))) {
      out.set(file, {});
      continue;
    }
    if (typeof on === "object" && !Array.isArray(on) && "workflow_run" in on) {
      out.set(file, (on.workflow_run ?? {}) as WorkflowRun);
    }
  }
  return out;
}

const hasBranchFilter = (t: WorkflowRun) =>
  (Array.isArray(t.branches) && t.branches.length > 0) ||
  (Array.isArray(t["branches-ignore"]) && t["branches-ignore"].length > 0);

describe("every workflow_run trigger filters its branches (Q1686)", () => {
  const triggers = workflowRunTriggers();

  it("reads the real workflow_run workflows", () => {
    // 4 on 2026-10-12: dependabot-auto-merge, land-queue, main-red-watch, open-auto-tick.
    expect(triggers.size).toBeGreaterThan(3);
    expect([...triggers.keys()]).toContain("dependabot-auto-merge.yml");
  });

  it("no workflow_run trigger outside the exact all-branches list lacks a branches filter", () => {
    const unfiltered = [...triggers].filter(([, t]) => !hasBranchFilter(t)).map(([f]) => f).sort();
    expect(
      unfiltered,
      "add `branches:` to the workflow_run trigger (each unfiltered run queues a runner job on every PR), or list it in ALL_BRANCHES with its reason",
    ).toEqual(Object.keys(ALL_BRANCHES).sort());
  });

  it("dependabot auto-merge only runs for dependabot's own branches", () => {
    expect(triggers.get("dependabot-auto-merge.yml")?.branches).toEqual(["dependabot/**"]);
  });

  it("fixture: the filter check tells a filtered trigger from a bare one", () => {
    expect(hasBranchFilter({ workflows: ["Test"], branches: ["main"] })).toBe(true);
    expect(hasBranchFilter({ workflows: ["Test"], "branches-ignore": ["land/**"] })).toBe(true);
    expect(hasBranchFilter({ workflows: ["Test"] })).toBe(false);
    expect(hasBranchFilter({ workflows: ["Test"], branches: [] })).toBe(false);
  });
});
