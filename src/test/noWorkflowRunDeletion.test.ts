/**
 * NOTHING IN THE REPO CAN DELETE GITHUB ACTIONS RUNS (Q1886).
 *
 * THE BUG: GitHub has no run of any workflow created between 2026-10-01 01:40Z
 * and 2026-10-03 15:54Z (sec-c, 2026-10-17: `actions/runs?created=2026-10-02`
 * total_count 0, against 1685 on 2026-09-30), and on 2026-10-30 a bulk delete of
 * 4549 completed runs took 47 db-deploy receipts with it and turned db-deploy's
 * provenance check red (scripts/audit/migration-provenance.json lostRuns). Run
 * history is the evidence db-deploy, the land queue and every audit lean on;
 * the owner's rule since then is never to delete Actions runs.
 *
 * THE CHECK, over every tracked code file in the repo (shell, YAML, JS/TS, Python,
 * HTML), comments blanked, tests and docs left out: no file may
 *   1. run `gh run delete`;
 *   2. send DELETE to a `.../actions/runs...` REST path (`gh api -X DELETE`,
 *      `--method DELETE`, curl `-X DELETE`, or fetch with method "DELETE");
 *   3. call Octokit's deleteWorkflowRun / deleteWorkflowRunLogs;
 *   4. `uses:` a marketplace action that deletes or cleans workflow runs.
 * No allowlist: nothing in the repo needs one (measured on origin/main
 * 2026-11-02: 0 hits). The scan reads git's index, so a new file counts once
 * it is staged, which every commit hook and CI run is.
 *
 * @mutate scripts/prune-stale-branches.mjs | #!/usr/bin/env node | #!/usr/bin/env node\nexecFileSync("gh", ["api", "-X", "DELETE", `repos/${repo}/actions/runs/${id}`]);
 * @mutate .github/workflows/branch-prune.yml | name: Branch prune | name: Branch prune\n# a comment stays allowed: gh api -X DELETE x\nenv:\n  CLEAN: gh run delete 1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const CODE = /\.(sh|bash|ya?ml|m?[jt]sx?|mts|cjs|py|html)$/;
const isTest = (f: string) => /\.test\.[cm]?[jt]sx?$/.test(f) || f.startsWith("src/test/") || /(^|\/)__tests__\//.test(f);

const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter((f) => f && CODE.test(f) && !isTest(f));

function code(f: string): string {
  const raw = readFileSync(join(ROOT, f), "utf8");
  if (/\.(sh|bash|ya?ml|py)$/.test(f)) return blankHashComments(raw);
  if (/\.html$/.test(f)) return raw;
  return blankComments(raw);
}

/** A DELETE method, as a shell flag (`-X DELETE`, `--method=DELETE`), an argv pair (`"-X", "DELETE"`) or a fetch option. */
const DEL = String.raw`(?:(?:-X|--method|--request)["'\x60]?[\s=,]*["'\x60]?DELETE\b|method:\s*["'\x60]DELETE["'\x60])`;

const RULES: Array<[string, RegExp]> = [
  ["gh run delete", /\bgh\s+run\s+delete\b/],
  ["DELETE on actions/runs", new RegExp(`${DEL}[^\\n]{0,300}actions/runs|actions/runs[^\\n]{0,300}${DEL}`, "i")],
  ["Octokit deleteWorkflowRun", /\bdeleteWorkflowRun(Logs)?\b/],
  ["run-deleting marketplace action", /\buses:\s*["']?[\w.-]+\/[\w.-]*(delete|clean|purge|prune|remove)[\w.-]*workflow[\w.-]*runs?\b/i],
];

/** Every rule a source text breaks (exported shape kept local: the self-test below feeds it fixtures). */
function hits(text: string): string[] {
  return RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

describe("nothing in the repo deletes GitHub Actions runs (Q1886)", () => {
  it("reads the repo's code (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(3000);
    expect(files.filter((f) => f.startsWith(".github/workflows/")).length).toBeGreaterThan(50);
    expect(files.filter((f) => f.startsWith("scripts/")).length).toBeGreaterThan(300);
  });

  it("each rule catches its shape and leaves a cancel or a read alone", () => {
    expect(hits("gh run delete 123")).toEqual(["gh run delete"]);
    expect(hits('gh api -X DELETE "repos/$R/actions/runs/$id"')).toEqual(["DELETE on actions/runs"]);
    expect(hits("gh api repos/o/r/actions/runs/1/logs --method DELETE")).toEqual(["DELETE on actions/runs"]);
    expect(hits('execFileSync("gh", ["api", "-X", "DELETE", `repos/${repo}/actions/runs/${id}`])')).toEqual(["DELETE on actions/runs"]);
    expect(hits('await fetch(`${api}/actions/runs/${id}`, { method: "DELETE" })')).toEqual(["DELETE on actions/runs"]);
    expect(hits("await octokit.rest.actions.deleteWorkflowRun({ owner, repo, run_id })")).toEqual(["Octokit deleteWorkflowRun"]);
    expect(hits("      - uses: Mattraks/delete-workflow-runs@39f0bbed25d76b34de5594dceab824811479e5de # v2")).toEqual(["run-deleting marketplace action"]);
    expect(hits("gh run cancel 123 && gh run list --limit 5")).toEqual([]);
    expect(hits("gh api repos/o/r/actions/runs?created=2026-10-02")).toEqual([]);
  });

  it("no tracked code file deletes a run", () => {
    const found = files.flatMap((f) => hits(code(f)).map((rule) => `${f}: ${rule}`));
    expect(found).toEqual([]);
  });
});
