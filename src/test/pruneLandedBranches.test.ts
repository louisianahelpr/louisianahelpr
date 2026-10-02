/*
 * GUARD: the hygiene script deletes a local branch whose work LANDED on main
 * under new SHAs (land.sh rebases every PR before it merges), and still keeps a
 * branch with even one patch that is not on main.
 * Before this, the rule was `git branch --merged origin/main` (SHA ancestry), so
 * every rebase-landed branch read as unlanded: a 2026-10-02 run skipped 24
 * branches and deleted 0. Runs scripts/lib/branchHygiene.mjs against a real
 * fixture repo (bare origin + clone).
 */
// @mutate scripts/lib/branchHygiene.mjs |   const landed = f.merged \|\| f.unlanded === 0; |   const landed = f.merged;
// @mutate scripts/lib/branchHygiene.mjs |   if (f.checkedOut) return | if (false) return
// @mutate scripts/lib/branchHygiene.mjs |   if (f.ageMs !== null && f.ageMs < minAgeMs) { |   if (false) {
// @mutate scripts/lib/branchHygiene.mjs |         : gitIn(repo, ["update-ref", "-d", `refs/heads/${d.branch}`, d.sha]); |         : gitIn(repo, ["update-ref", "-d", `refs/heads/${d.branch}`]);
// @mutate scripts/prune-git-hygiene.mjs |   const bplan = planBranchCleanup(process.cwd(), { checkedOut, | const bplan = planBranchCleanup(process.cwd(), { checkedOut: new Set(), unused: checkedOut,
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { planBranchCleanup, applyBranchPlan, type BranchPlan } from "../../scripts/lib/branchHygiene.mjs";

const H = 3600_000;
let root = "";
let main = "";

function git(cwd: string, ...argv: string[]) {
  return execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
      GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}
function commit(cwd: string, file: string, body: string) {
  writeFileSync(join(cwd, file), body);
  git(cwd, "add", file);
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `add ${file}`);
}
const plan = (o: Partial<Parameters<typeof planBranchCleanup>[1]> = {}): BranchPlan =>
  planBranchCleanup(main, { checkedOut: new Set(["main", "busy"]), nowMs: Date.now() + 3 * H, minAgeMs: 2 * H, ...o });
const del = (p: BranchPlan) => p.delete.map((d) => d.branch).sort();
const skipReason = (p: BranchPlan, b: string) => p.skip.find((s) => s.branch === b)?.reason;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-branch-hyg-")));
  const origin = join(root, "origin.git");
  main = join(root, "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "checkout", "-q", "-b", "main");
  commit(main, "a.txt", "a\n");
  git(main, "push", "-q", "origin", "main");

  // A branch whose tip is an ancestor of origin/main (the old --merged case).
  git(main, "branch", "ancestor");

  // Two commits on a branch, then main moves, then land.sh-style: the branch is
  // REBASED onto main and fast-forwarded in, so main holds the work under NEW shas
  // and the original branch tip is not an ancestor of main.
  git(main, "checkout", "-q", "-b", "rebased", "main");
  commit(main, "r1.txt", "r1\n");
  commit(main, "r2.txt", "r2\n");
  git(main, "checkout", "-q", "main");
  commit(main, "other.txt", "other\n");
  git(main, "checkout", "-q", "-b", "land-tmp", "rebased");
  git(main, "-c", "commit.gpgsign=false", "rebase", "-q", "main");
  git(main, "checkout", "-q", "main");
  git(main, "merge", "-q", "--ff-only", "land-tmp");
  git(main, "branch", "-q", "-D", "land-tmp");

  // Same rebased-and-landed work plus ONE extra patch that never landed.
  git(main, "checkout", "-q", "-b", "one-unlanded", "rebased");
  commit(main, "u.txt", "unlanded\n");
  // Landed by patch, but checked out somewhere: kept.
  git(main, "branch", "busy", "rebased");

  git(main, "checkout", "-q", "main");
  git(main, "push", "-q", "origin", "main");
  git(main, "fetch", "-q", "origin");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("rebase-landed branches are cleaned up; unlanded ones are kept", () => {
  it("the fixture is the land.sh shape: the rebased tip is NOT an ancestor of origin/main", () => {
    let ancestor = true;
    try {
      git(main, "merge-base", "--is-ancestor", "rebased", "origin/main");
    } catch {
      ancestor = false;
    }
    expect(ancestor).toBe(false);
    expect(git(main, "cherry", "origin/main", "rebased").split("\n").every((l) => l.startsWith("-"))).toBe(true);
    const p = plan();
    expect(p.delete.length + p.skip.length).toBeGreaterThan(3);
  });

  it("a rebased-and-landed branch is eligible (patch-equivalent), as is an ancestor", () => {
    const p = plan();
    expect(del(p)).toEqual(["ancestor", "rebased"]);
    expect(p.delete.find((d) => d.branch === "rebased")?.how).toBe("patch");
    expect(p.delete.find((d) => d.branch === "ancestor")?.how).toBe("merged");
  });

  it("a branch with one patch not on main is still skipped, and says which", () => {
    const p = plan();
    expect(skipReason(p, "one-unlanded")).toMatch(/^1 patch\(es\) not on origin\/main: add u\.txt$/);
  });

  it("keeps the other safety skips: checked out, and the age gate", () => {
    expect(skipReason(plan(), "busy")).toBe("checked out in a worktree");
    const young = plan({ nowMs: Date.now() });
    expect(young.delete).toEqual([]);
    expect(skipReason(young, "rebased")).toMatch(/created\/moved \d+m ago/);
  });

  it("applying deletes exactly the landed branches, refusing one that moved after the check", () => {
    const p = plan();
    // the 'rebased' branch moves between plan and apply: the compare-and-delete must refuse
    const stale: BranchPlan = { ...p, delete: p.delete.map((d) => (d.branch === "rebased" ? { ...d, sha: git(main, "rev-parse", "main") } : d)) };
    const r1 = applyBranchPlan(main, stale);
    expect(r1.deleted).toEqual(["ancestor"]);
    expect(r1.refused.map((r) => r.branch)).toEqual(["rebased"]);

    const r2 = applyBranchPlan(main, plan());
    expect(r2.refused).toEqual([]);
    expect(r2.deleted).toEqual(["rebased"]);
    const left = git(main, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n").sort();
    expect(left).toEqual(["busy", "main", "one-unlanded"]);
  });

  it("the hygiene script uses the rule with the real checked-out set", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-git-hygiene.mjs"), "utf8");
    expect(src).toMatch(/planBranchCleanup\(process\.cwd\(\), \{ checkedOut, base: BASE, minAgeMs: MIN_AGE_MS/);
    expect(src).toMatch(/applyBranchPlan\(process\.cwd\(\), bplan\)/);
    expect(src).not.toMatch(/"branch", "--merged"/);
  });
});
