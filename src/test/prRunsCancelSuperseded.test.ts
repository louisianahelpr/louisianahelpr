// Duplicate work (owner, 2026-10-02: "get rid of the duplicate work"): a PR
// workflow whose concurrency does not cancel the older run on a new push runs
// the whole job twice, and both copies sit in the same runner queue as the
// required checks. Every workflow with a pull_request trigger must cancel a
// superseded PR run.
// @mutate .github/workflows/test.yml | cancel-in-progress: ${{ github.event_name == 'pull_request' }} | cancel-in-progress: false
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "../../.github/workflows");

function hasPrTrigger(yml: string): boolean {
  const onBlock = yml.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m)?.[1] ?? yml.match(/^on:.*$/m)?.[0] ?? "";
  return /^\s*pull_request:|^on:.*pull_request\b|^\s*-\s*pull_request\s*$/m.test(onBlock);
}

export function prRunsWithoutCancel(files: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [name, yml] of Object.entries(files)) {
    if (!hasPrTrigger(yml)) continue;
    const conc = yml.match(/^concurrency:\s*\n((?:[ \t]+.*\n)*)/m)?.[1] ?? "";
    const cancel = conc.match(/^\s*cancel-in-progress:\s*(.+)$/m)?.[1].trim() ?? "";
    const ok =
      cancel === "true" ||
      /github\.event_name\s*==\s*'pull_request'/.test(cancel) ||
      /github\.event_name\s*!=\s*'(schedule|push|workflow_dispatch)'/.test(cancel);
    if (!ok) bad.push(name);
  }
  return bad.sort();
}

describe("PR runs cancel superseded runs", () => {
  const files = Object.fromEntries(
    readdirSync(DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(join(DIR, f), "utf8")]),
  );

  it("every pull_request workflow cancels the older run on a new push", () => {
    // 65 workflow files on 2026-10-02; an empty read would pass every check below.
    expect(Object.keys(files).length).toBeGreaterThan(50);
    // Floor: a trigger regex that matched nothing would pass vacuously.
    expect(Object.values(files).filter(hasPrTrigger).length).toBeGreaterThan(5);
    expect(prRunsWithoutCancel(files)).toEqual([]);
  });

  it("fails on a pull_request workflow that queues instead of cancelling", () => {
    const yml = "on:\n  pull_request:\nconcurrency:\n  group: x-${{ github.ref }}\n  cancel-in-progress: false\n";
    expect(prRunsWithoutCancel({ "x.yml": yml })).toEqual(["x.yml"]);
    expect(prRunsWithoutCancel({ "y.yml": "on:\n  pull_request:\njobs: {}\n" })).toEqual(["y.yml"]);
  });
});
// @mutate .github/workflows/vitest.yml | cancel-in-progress: ${{ github.event_name == 'pull_request' }} | cancel-in-progress: false
