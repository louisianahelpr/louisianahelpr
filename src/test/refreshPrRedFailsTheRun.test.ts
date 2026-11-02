/**
 * Q2395: scoreboard.yml must go RED while its previous refresh PR is still open and red.
 *
 * Measured 11-02: the `land` job concluded success once refresh-pr had opened or updated the bot PR, so #3550 sat
 * with a red required check ('Vitest unit tests', 10-22..10-29) and #3799 after it, while every scheduled run was
 * green and docs/SCOREBOARD.md went 10-21 -> 11-01 without landing. scripts/ci/previous-refresh-pr-red.mjs reads the
 * open PR's checks before the branch is replaced; a last step fails the job (and `notify` files nightly-red) unless
 * it answered false. A gh failure answers unknown, which also fails: not looked is not green.
 *
 * @mutate .github/workflows/scoreboard.yml |         if: steps.prev.outputs.red != 'false' |         if: steps.prev.outputs.red == 'true-never'
 * @mutate scripts/ci/previous-refresh-pr-red.mjs | export const RED = new Set(["FAILURE", | export const RED = new Set([
 * @mutate scripts/ci/previous-refresh-pr-red.mjs |     result = { red: "unknown", |     result = { red: "false",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { redPrs, verdict } from "../../scripts/ci/previous-refresh-pr-red.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("the previous refresh PR's red checks are read (Q2395)", () => {
  it("a failed required check is red; cancelled, skipped and passing ones are not", () => {
    const prs = [
      { number: 3550, statusCheckRollup: [{ name: "Vitest unit tests", conclusion: "FAILURE" }, { name: "CodeQL", conclusion: "SUCCESS" }] },
      { number: 9, statusCheckRollup: [{ name: "Vitest shard 1/6", conclusion: "CANCELLED" }, { name: "CodeRabbit", conclusion: "SKIPPED" }, { context: "ci/x", state: "SUCCESS" }] },
    ];
    expect(redPrs(prs)).toEqual([{ number: 3550, url: undefined, red: ["Vitest unit tests"] }]);
    expect(verdict(prs)).toMatchObject({ red: "true" });
    expect(verdict(prs).message).toContain("#3550 (Vitest unit tests)");
  });

  it("a commit status in error is red; no open PR is not", () => {
    expect(redPrs([{ number: 1, statusCheckRollup: [{ context: "legacy", state: "ERROR" }] }])).toHaveLength(1);
    expect(verdict([])).toEqual({ red: "false", message: "no open refresh PR has a red check" });
    expect(verdict([{ number: 2, statusCheckRollup: [] }]).red).toBe("false");
  });

  it("a read that fails answers unknown, never false", () => {
    const src = read("scripts/ci/previous-refresh-pr-red.mjs");
    expect(src).toMatch(/catch \(err\) \{\n\s*result = \{ red: "unknown",/);
  });
});

describe("scoreboard.yml goes red on it", () => {
  const wf = parse(read(".github/workflows/scoreboard.yml")) as { jobs: Record<string, { steps: { id?: string; uses?: string; run?: string; if?: string; name?: string }[] }> };
  const steps = wf.jobs.land.steps;
  const at = (pred: (s: (typeof steps)[number]) => boolean) => steps.findIndex(pred);

  it("reads the previous PR before refresh-pr replaces its branch, and fails after it unless the answer is false", () => {
    expect(steps.length).toBeGreaterThan(3);
    const prev = at((s) => s.id === "prev");
    const refresh = at((s) => s.uses === "./.github/actions/refresh-pr");
    const fail = at((s) => s.if === "steps.prev.outputs.red != 'false'");
    expect(prev).toBeGreaterThan(-1);
    expect(steps[prev].run).toBe("node scripts/ci/previous-refresh-pr-red.mjs bot/refresh/scoreboard");
    expect(refresh).toBeGreaterThan(prev);
    expect(fail).toBeGreaterThan(refresh);
    expect(steps[fail].run).toMatch(/exit 1/);
    // The run's verdict is what `notify` turns into the nightly-red issue.
    expect(read(".github/workflows/scoreboard.yml")).toContain("needs.land.result == 'success'");
  });
});
