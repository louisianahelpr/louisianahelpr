// @mutate scripts/prune-stale-branches.mjs | .filter((line) => line.startsWith("+")).length; | .filter((line) => line.startsWith("-")).length;
// @mutate scripts/prune-stale-branches.mjs | if (!Number.isInteger(mergesAhead) \|\| mergesAhead !== 0) { | if (false) {
// @mutate scripts/prune-stale-branches.mjs | `--force-with-lease=refs/heads/${name}:${sha}`, "origin" | "--force", "origin"
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideBranch, inspectBranch, deleteBranch } from "../../scripts/prune-stale-branches.mjs";

/**
 * Stale remote branches kept piling up: delete_branch_on_merge only fires on a
 * MERGED PR, so PRs closed unmerged (superseded by a batch PR) and stray
 * pushes left their branches behind. scripts/prune-stale-branches.mjs (run by
 * .github/workflows/branch-prune.yml) deletes a branch only when `git cherry`
 * shows every patch already on main, no merge commit is ahead of main (cherry
 * skips merges, so work inside a merge commit is invisible to it), and no open
 * PR uses it. The delete is leased to the SHA it inspected.
 */
describe("prune-stale-branches decideBranch", () => {
  it("never deletes main, even with nothing ahead", () => {
    expect(decideBranch({ name: "main", hasOpenPr: false, cherryOutput: "", mergesAhead: 0 }).action).toBe("KEEP");
  });

  it("keeps a branch with an open PR even when its commits are on main", () => {
    expect(
      decideBranch({ name: "feat/x", hasOpenPr: true, cherryOutput: "- abc123\n", mergesAhead: 0 }).action,
    ).toBe("KEEP");
  });

  it("deletes a branch whose every commit is already on main", () => {
    const r = decideBranch({
      name: "agent/done",
      hasOpenPr: false,
      cherryOutput: "- 1111111\n- 2222222\n",
      mergesAhead: 0,
    });
    expect(r.action).toBe("DELETE");
  });

  it("keeps a branch with any commit not on main as UNLANDED", () => {
    const r = decideBranch({
      name: "agent/wip",
      hasOpenPr: false,
      cherryOutput: "- 1111111\n+ 3333333\n",
      mergesAhead: 0,
    });
    expect(r.action).toBe("UNLANDED");
    expect(r.reason).toContain("1 commit");
  });

  it("keeps a branch with a merge commit ahead of main, or an unread merge count", () => {
    for (const mergesAhead of [1, Number.NaN]) {
      expect(decideBranch({ name: "agent/m", hasOpenPr: false, cherryOutput: "", mergesAhead }).action).toBe(
        "UNLANDED",
      );
    }
  });
});

describe("prune-stale-branches against a real git remote", () => {
  let dir = "";
  let w = "";
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  // Every git call gets its own timestamp, one minute apart: commits made in the
  // same second tie in git's date-ordered revision walk, and `git cherry`'s
  // output then varied between runs of the same fixture (seen 2026-10-01).
  let clock = 1_700_000_000;
  const g = (cwd: string, ...args: string[]) => {
    const date = `@${(clock += 60)} +0000`;
    return execFileSync("git", ["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
  const commit = (file: string, text: string, msg: string) => {
    appendFileSync(join(w, file), text);
    g(w, "add", file);
    g(w, "commit", "-qm", msg);
  };
  const decide = (name: string) => {
    const { cherryOutput, mergesAhead } = inspectBranch(name, w);
    return decideBranch({ name, hasOpenPr: false, cherryOutput, mergesAhead }).action;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-branches-"));
    const remote = join(dir, "remote.git");
    w = join(dir, "w");
    g(dir, "init", "-q", "--bare", remote);
    g(dir, "init", "-q", w);
    g(w, "remote", "add", "origin", remote);
    commit("f", "base\n", "base");
    // landed: its one patch is cherry-picked onto main.
    g(w, "checkout", "-qb", "landed");
    commit("a", "a\n", "a");
    g(w, "checkout", "-q", "main");
    g(w, "cherry-pick", "landed");
    commit("m", "m\n", "m");
    // unlanded: a commit main does not have.
    g(w, "checkout", "-qb", "unlanded", "main");
    commit("u", "u\n", "u");
    // evilmerge: a stale branch (off main's first commit) that merges main and
    // adds content inside the merge commit only. Its one commit off main is the
    // merge, which `git cherry` skips, so cherry prints nothing for it.
    g(w, "checkout", "-qb", "evilmerge", "main~2");
    g(w, "merge", "-q", "--no-ff", "--no-commit", "main");
    appendFileSync(join(w, "f"), "EVIL\n");
    g(w, "add", "f");
    g(w, "commit", "-qm", "merge main");
    g(w, "push", "-q", "origin", "main", "landed", "unlanded", "evilmerge");
    g(w, "fetch", "-q", "origin");
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes only the branch whose work is all on main", () => {
    expect(decide("landed")).toBe("DELETE");
    expect(decide("unlanded")).toBe("UNLANDED");
  });

  it("keeps a branch whose only unlanded content is inside a merge commit", () => {
    expect(g(w, "diff", "origin/main", "origin/evilmerge")).toContain("EVIL");
    expect(g(w, "cherry", "origin/main", "origin/evilmerge")).not.toContain("+");
    expect(decide("evilmerge")).toBe("UNLANDED");
  });

  it("refuses the delete when the branch moved after it was inspected", () => {
    const { sha } = inspectBranch("landed", w);
    g(w, "checkout", "-q", "landed");
    commit("late", "late\n", "late push");
    g(w, "push", "-q", "origin", "landed");
    expect(() => deleteBranch("landed", sha, w)).toThrow();
    expect(g(w, "ls-remote", "--heads", "origin", "landed")).toContain("refs/heads/landed");
  });
});
