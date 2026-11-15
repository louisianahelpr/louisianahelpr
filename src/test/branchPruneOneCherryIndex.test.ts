/**
 * Q2800 (schedule-stalled #4450, 2026-11-13..14): every scheduled branch-prune run was cancelled at the prune job's
 * 10-minute timeout inside `prune-stale-branches.mjs --apply` (run 43648333291: 22:29:39 -> 22:39:30, no output), so
 * nothing was ever deleted and origin grew to 2266 branches. `git cherry origin/main origin/<b>` re-diffs every main
 * commit since the branch's merge base, once per branch: 597 ms a branch measured locally (~22 min for all).
 *
 * The script now answers each cherry from ONE patch-id index of main (cherryIndexedGit). This holds, on a real git
 * repo, that the answer is git cherry's own (a rebased patch "-", a new patch "+", merges skipped, oldest first, -v
 * carries the subject), and that main is indexed once however many branches are asked about.
 *
 * @mutate scripts/prune-stale-branches.mjs |     mainIds ??= new Set(idsOf("origin/main").values()); |     mainIds = new Set(idsOf("origin/main").values());
 * @mutate scripts/prune-stale-branches.mjs |       const mark = pid && mainIds.has(pid) ? "-" : "+"; |       const mark = pid ? "-" : "+";
 * @mutate scripts/prune-stale-branches.mjs |       cherryOutput:\n        isProtected(name) \|\| openHeads.has(name) ? "" : cherryGit(["cherry", "origin/main", `origin/${name}`]), |       cherryOutput:\n        isProtected(name) \|\| openHeads.has(name) ? "" : git(["cherry", "origin/main", `origin/${name}`]),
 * @mutate scripts/prune-stale-branches.mjs | findStranded(cherryGit, branches, | findStranded(git, branches,
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cherryIndexedGit, patchIdsOf } from "../../scripts/prune-stale-branches.mjs";

let dir = "";
const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-11-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-01T00:00:00Z" } });
const commit = (file: string, text: string, msg: string) => {
  writeFileSync(join(dir, file), text);
  git(["add", file]);
  git(["commit", "-qm", msg]);
  return git(["rev-parse", "HEAD"]).trim();
};
const BRANCHES = ["feat/landed", "feat/half", "feat/merge"];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "prune-cherry-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  commit("base.txt", "base\n", "base");
  // feat/landed: one commit, later re-applied on main under a new sha (a rebase landing).
  git(["checkout", "-qb", "feat/landed"]);
  commit("a.txt", "a\n", "fix(a): landed");
  // feat/half: one patch that lands, one that does not.
  git(["checkout", "-q", "main"]);
  git(["checkout", "-qb", "feat/half"]);
  commit("b.txt", "b\n", "fix(b): lands");
  commit("c.txt", "c\n", "fix(c): only here");
  // feat/merge: a merge commit (skipped by cherry) over one unlanded patch.
  git(["checkout", "-q", "main"]);
  git(["checkout", "-qb", "feat/merge"]);
  commit("d.txt", "d\n", "fix(d): only here");
  git(["merge", "-q", "--no-ff", "-m", "merge feat/landed", "feat/landed"]);
  // main moves on: a.txt and b.txt land as new commits, plus unrelated work.
  git(["checkout", "-q", "main"]);
  commit("z.txt", "z\n", "chore: unrelated");
  commit("a.txt", "a\n", "fix(a): landed (rebased)");
  commit("b.txt", "b\n", "fix(b): lands (rebased)");
  for (const b of ["main", ...BRANCHES]) git(["update-ref", `refs/remotes/origin/${b}`, b]);
}, 60_000);

afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("branch prune answers git cherry from one index of main (Q2800)", () => {
  it("gives git cherry's own answer, plain and -v, for every branch", () => {
    const fast = cherryIndexedGit(git, (range) => patchIdsOf(range, dir));
    let compared = 0;
    for (const b of BRANCHES) {
      for (const v of [[], ["-v"]]) {
        const args = ["cherry", ...v, "origin/main", `origin/${b}`];
        expect(fast(args), args.join(" ")).toBe(git(args));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5);
    // The shapes that matter, spelled out: a rebased patch is on main, a new one is not.
    expect(fast(["cherry", "origin/main", "origin/feat/landed"])).toMatch(/^- [0-9a-f]{40}\n$/);
    expect(fast(["cherry", "-v", "origin/main", "origin/feat/half"])).toMatch(/^- [0-9a-f]{40} fix\(b\): lands\n\+ [0-9a-f]{40} fix\(c\): only here\n$/);
  });

  it("indexes main once, however many branches it is asked about", () => {
    const asked: string[] = [];
    const fast = cherryIndexedGit(git, (range) => { asked.push(range); return patchIdsOf(range, dir); });
    for (const b of BRANCHES) { fast(["cherry", "origin/main", `origin/${b}`]); fast(["cherry", "-v", "origin/main", `origin/${b}`]); }
    expect(asked.filter((r) => r === "origin/main")).toHaveLength(1);
    // Each branch is diffed once for both passes.
    expect(asked.filter((r) => r !== "origin/main").sort()).toEqual(BRANCHES.map((b) => `origin/main..origin/${b}`).sort());
  });

  it("the script's own prune and stranded passes ask the index, never git cherry directly", () => {
    const code = blankComments(readFileSync(join(__dirname, "../../scripts/prune-stale-branches.mjs"), "utf8"));
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toContain("const cherryGit = cherryIndexedGit(git);");
    expect(code).toContain('cherryGit(["cherry", "origin/main", `origin/${name}`])');
    expect(code).toContain("findStranded(cherryGit, branches,");
    expect(code).not.toMatch(/\bgit\(\["cherry"/);
  });

  it("passes every other git command straight through", () => {
    const fast = cherryIndexedGit(git, () => { throw new Error("must not index for a non-cherry command"); });
    expect(fast(["rev-parse", "origin/main"]).trim()).toBe(git(["rev-parse", "main"]).trim());
  });
});
