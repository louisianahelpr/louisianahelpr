/**
 * A RED loading-state measurement still reaches git (docs/OPEN.md Q408).
 *
 * loading-states-refresh 36165226511 (2026-09-25) produced the measurement the
 * baseline fix needed, but its land job ran only on a green measure job, and
 * the fresh measurements.json existed only as a CI artifact, which the lead's
 * container cannot download (the proxy blocks the artifact blob host). So the
 * committed file stayed a day old and src/test/loadingStateShape.test.ts kept
 * grading the new baseline against it. The land job now runs whenever the
 * measure STEP succeeded, whatever the budget or shape verdict said; the PR
 * still auto-merges only through main's required checks.
 *
 * @mutate .github/workflows/loading-states-refresh.yml | if: always() && needs.measure.outputs.measured == 'success' | if: needs.measure.result == 'success'
 * @mutate .github/workflows/loading-states-refresh.yml | measured: ${{ steps.measure.outcome }} | measured: ${{ job.status }}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type Job = { if?: string; needs?: string[] | string; outputs?: Record<string, string>; steps?: { id?: string; uses?: string; run?: string }[] };
const wf = parse(readFileSync(resolve(__dirname, "../../.github/workflows/loading-states-refresh.yml"), "utf8")) as { jobs: Record<string, Job> };

describe("loading-states-refresh lands every measurement it produced", () => {
  it("the measure job exports whether its measure STEP succeeded", () => {
    const measure = wf.jobs.measure;
    expect(measure.steps?.some((s) => s.id === "measure" && /loading-states:measure/.test(s.run ?? ""))).toBe(true);
    expect(measure.outputs?.measured).toBe("${{ steps.measure.outcome }}");
  });

  it("the land job runs on that output, not on the job's verdict", () => {
    const land = wf.jobs.land;
    expect(land.steps?.some((s) => s.uses === "./.github/actions/refresh-pr")).toBe(true);
    expect(land.if).toMatch(/always\(\)/);
    expect(land.if).toMatch(/needs\.measure\.outputs\.measured == 'success'/);
    expect(land.if).not.toMatch(/needs\.measure\.result/);
  });
});
