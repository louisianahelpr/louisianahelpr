// @mutate scripts/prune-stale-branches.mjs | .filter((line) => line.startsWith("+")).length; | .filter((line) => line.startsWith("-")).length;
import { describe, it, expect } from "vitest";
import { decideBranch } from "../../scripts/prune-stale-branches.mjs";

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
      decideBranch({ name: "feat/x", hasOpenPr: true, cherryOutput: "- abc123\n" }).action,
    ).toBe("KEEP");
  });

  it("deletes a branch whose every commit is already on main", () => {
    const r = decideBranch({
      name: "agent/done",
      hasOpenPr: false,
      cherryOutput: "- 1111111\n- 2222222\n",
    });
    expect(r.action).toBe("DELETE");
  });

  it("keeps a branch with any commit not on main as UNLANDED", () => {
    const r = decideBranch({
      name: "agent/wip",
      hasOpenPr: false,
      cherryOutput: "- 1111111\n+ 3333333\n",
    });
    expect(r.action).toBe("UNLANDED");
    expect(r.reason).toContain("1 commit");
  });
});
