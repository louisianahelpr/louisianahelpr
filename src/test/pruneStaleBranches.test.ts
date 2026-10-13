// @mutate scripts/prune-stale-branches.mjs | .filter((c) => !covered.has(c.subject)); | ;
// @mutate scripts/prune-stale-branches.mjs | if (!(ageHours >= STRANDED_AFTER_HOURS)) return false; | 
// @mutate scripts/prune-stale-branches.mjs | if (hasOpenPr) return false; | 
// @mutate scripts/prune-stale-branches.mjs |   if (neverLand(name, uncovered)) return false; |
// @mutate scripts/prune-stale-branches.mjs | return uncovered.length > 0; | return false;
// @mutate scripts/prune-stale-branches.mjs | .filter((line) => line.startsWith("+")).length; | .filter((line) => line.startsWith("-")).length;
// @mutate scripts/prune-stale-branches.mjs | export const PROTECTED_PREFIXES = ["land/"]; | export const PROTECTED_PREFIXES = [];
// @mutate scripts/prune-stale-branches.mjs | if (!(ageHours >= MIN_AGE_HOURS)) { | if (false) {
// @mutate scripts/prune-stale-branches.mjs | `--force-with-lease=refs/heads/${r.name}:${tipOf.get(r.name)}`, | 
// @mutate scripts/prune-stale-branches.mjs |   if (unlanded === 0 && contentStranded) { |   if (false) {
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  decideBranch,
  isStranded,
  READY_QUEUE_GRACE_HOURS,
  uncoveredCommits,
  waitingForTrain,
} from "../../scripts/prune-stale-branches.mjs";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";

/**
 * Stale remote branches kept piling up: delete_branch_on_merge only fires on a
 * MERGED PR, so PRs closed unmerged (superseded by a batch PR) and stray
 * pushes left their branches behind. scripts/prune-stale-branches.mjs (run by
 * .github/workflows/branch-prune.yml) deletes a branch only when `git cherry`
 * shows every patch already on main and no open PR uses it.
 */
describe("prune-stale-branches decideBranch", () => {
  it("keeps a branch with an open PR even when its commits are on main", () => {
    expect(
      decideBranch({ name: "feat/x", hasOpenPr: true, cherryOutput: "- abc123\n", ageHours: 99 }).action,
    ).toBe("KEEP");
  });

  it("deletes a branch whose every commit is already on main", () => {
    const r = decideBranch({
      name: "agent/done",
      hasOpenPr: false,
      ageHours: 48,
      cherryOutput: "- 1111111\n- 2222222\n",
    });
    expect(r.action).toBe("DELETE");
  });

  it("never deletes a branch whose patches are on main but whose content is not (Q1146: cherry skips merges)", () => {
    const r = decideBranch({
      name: "agent/merge-resolution",
      hasOpenPr: false,
      ageHours: 48,
      cherryOutput: "- 1111111\n",
      contentStranded: true,
    });
    expect(r.action).toBe("UNLANDED");
  });

  it("keeps a branch with any commit not on main as UNLANDED", () => {
    const r = decideBranch({
      name: "agent/wip",
      hasOpenPr: false,
      ageHours: 48,
      cherryOutput: "- 1111111\n+ 3333333\n",
    });
    expect(r.action).toBe("UNLANDED");
    expect(r.reason).toContain("1 commit");
  });

  it("never deletes a land/* branch: land.sh's PR head, removed by auto-merge itself", () => {
    const r = decideBranch({ name: "land/agent-x-1234", hasOpenPr: false, ageHours: 48, cherryOutput: "- 1111111\n" });
    expect(r).toMatchObject({ action: "KEEP", reason: "protected" });
  });

  it("keeps a fully-landed branch whose tip is under a day old (someone may be mid-push)", () => {
    const r = decideBranch({ name: "agent/fresh", hasOpenPr: false, ageHours: 2, cherryOutput: "- 1111111\n" });
    expect(r.action).toBe("KEEP");
    expect(r.reason).toMatch(/24h/);
  });

  it("deletes leased on the measured tip, so a branch pushed to since survives", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../scripts/prune-stale-branches.mjs"), "utf8");
    const del = src.slice(src.indexOf('"--delete"') - 200, src.indexOf('"--delete"'));
    expect(del).toContain("--force-with-lease=refs/heads/");
  });
});

/**
 * STRANDED (2026-10-02): the run-to-zero tier agents pushed their work to
 * agent/* branches and never landed it, and 15 such branches sat on origin
 * with no PR while the queue count did not move. A branch holding a commit
 * whose subject is on neither main nor any open PR head, older than an hour,
 * with no open PR, now makes the prune script exit 1 (nightly-red issue).
 */
describe("prune-stale-branches stranded work", () => {
  const cherry = "- aaa1111 already on main by patch\n+ bbb2222 fix(x): landed under a rewrite\n+ ccc3333 fix(y): only here\n";
  const covered = new Set(["fix(x): landed under a rewrite"]);

  it("a + commit whose subject is on main or an open PR is covered", () => {
    expect(uncoveredCommits(cherry, covered)).toEqual([{ sha: "ccc3333", subject: "fix(y): only here" }]);
  });

  it("a branch with uncovered work, no PR, over an hour old is stranded", () => {
    expect(isStranded({ name: "agent/medium", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(true);
  });

  it("an open PR, a fresh push, or fully covered work is not stranded", () => {
    expect(isStranded({ name: "agent/medium", hasOpenPr: true, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "agent/medium", hasOpenPr: false, ageHours: 0.5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "agent/medium", hasOpenPr: false, ageHours: 5, uncovered: [] })).toBe(false);
    // An accepted branch (content-checked into docs/audit/stranded-accepted.json) is never re-opened as an auto-land PR (2026-10-04 loop).
    expect(isStranded({ name: "agent/medium", hasOpenPr: false, ageHours: 5, uncovered: [{}], accepted: true })).toBe(false);
    // A red proof is never auto-landed (2026-10-06: #2444 opened with auto-merge on).
    expect(isStranded({ name: "q975-red-proof", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "q975-races-10-13-red", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "agent/fix", hasOpenPr: false, ageHours: 5, uncovered: [{ subject: "RED PROOF ONLY (do not land): races 10-13 with their guards removed" }] })).toBe(false);
    // ...and nothing else is caught by the marker.
    expect(isStranded({ name: "fix/redirect-red-banner", hasOpenPr: false, ageHours: 5, uncovered: [{ subject: "fix: the red banner" }] })).toBe(true);
    expect(isStranded({ name: "main", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
  });

  it("land/* branches are not exempt: a land branch with no PR is stranded too", () => {
    expect(isStranded({ name: "land/HEAD-6c1e1c10", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(true);
  });
});

/**
 * REPORT ONLY (lead, 2026-10-13; nightly-red #2910/#2911). branch-prune used to
 * open an "auto-land: <branch>" PR with rebase auto-merge for every stranded
 * branch: one of three paths opening PRs for the same work (144 open PRs on
 * 2026-10-12), so the workflow was disabled by hand and schedule-heartbeat went
 * red. The owner's rule is ONE landing path, the landing train. Now the script
 * and the workflow open no PR and turn on no auto-merge (comments ignored), the
 * workflow holds no PR-writing token, and a ready/* branch (the train's queue)
 * is stranded only once it has waited READY_QUEUE_GRACE_HOURS.
 *
 * Red first: the old script carried `gh(["pr", "create", ...])` and
 * `"--rebase", "--auto"`, and the workflow ran it with REFRESH_PR_TOKEN and
 * pull-requests: write.
 */
// @mutate scripts/prune-stale-branches.mjs |   // REPORT ONLY: nothing here opens a PR (one landing path, the train).\n | \n  if (stranded.length) execFileSync("gh", ["pr", "create", "--head", stranded[0].name]);\n
// @mutate scripts/prune-stale-branches.mjs |   if (waitingForTrain(name, ageHours)) return false; |
describe("prune-stale-branches is report only: it opens no PR", () => {
  const src = blankComments(fs.readFileSync(path.resolve(__dirname, "../../scripts/prune-stale-branches.mjs"), "utf8"));
  const wf = blankHashComments(fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/branch-prune.yml"), "utf8"));

  it("the files are read (inventory floor)", () => {
    expect(src).toContain("findStranded(");
    expect(src).toContain('"--delete"');
    expect(wf).toContain("node scripts/prune-stale-branches.mjs --apply");
  });

  it("the script never opens a PR, merges one or turns on auto-merge", () => {
    expect(src).not.toMatch(/["'`]pr["'`]\s*,\s*["'`](create|merge)["'`]/);
    expect(src).not.toMatch(/gh\s+pr\s+(create|merge)/);
    expect(src).not.toMatch(/["'`]--auto["'`]/);
    expect(src).not.toMatch(/\/pulls["'`]?\s*,\s*["'`]-X["'`]|-X["'`]?\s*,?\s*["'`]POST/);
  });

  it("the workflow holds no PR-writing token for it", () => {
    expect(wf).not.toContain("REFRESH_PR_TOKEN");
    expect(wf).not.toMatch(/pull-requests:\s*write/);
  });

  it("a ready/* branch is the train's queue: not stranded for READY_QUEUE_GRACE_HOURS, stranded after", () => {
    expect(READY_QUEUE_GRACE_HOURS).toBe(24);
    expect(waitingForTrain("ready/todo-b2-1", 5)).toBe(true);
    expect(waitingForTrain("ready/todo-b2-1", 25)).toBe(false);
    expect(waitingForTrain("fix/ready-thing", 5)).toBe(false);
    expect(isStranded({ name: "ready/todo-b2-1", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "ready/todo-b2-1", hasOpenPr: false, ageHours: 25, uncovered: [{}] })).toBe(true);
  });
});
