// @mutate scripts/prune-stale-branches.mjs | .filter((line) => line.startsWith("+")).length; | .filter((line) => line.startsWith("-")).length;
// @mutate scripts/prune-stale-branches.mjs | export const PROTECTED_PREFIXES = ["land/"]; | export const PROTECTED_PREFIXES = [];
// @mutate scripts/prune-stale-branches.mjs | if (!(ageHours >= MIN_AGE_HOURS)) { | if (false) {
// @mutate scripts/prune-stale-branches.mjs | `--force-with-lease=refs/heads/${r.name}:${tipOf.get(r.name)}`, | 
import fs from "node:fs";
import path from "node:path";
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
