/*
 * The scoreboard's remote-branch row counts branches carrying a patch main
 * lacks in ONE batch, not one `git cherry` per branch.
 *
 * Scheduled scoreboard run 41940832252 (2026-11-05 01:25Z) was cancelled at
 * its 20-minute timeout inside "Measure every signal" (nightly-red #4111): the
 * row ran `git cherry origin/main <ref>` for each of ~1,600-1,760 remote
 * branches, and that step had grown from 7 min (10-29) to 17.5 min (11-03).
 *
 * Proves, on a real throwaway repo, that countUnlanded gives git cherry's
 * verdict (a cherry-picked branch is landed, a new patch is not, a branch with
 * one landed and one new commit is unlanded), and that the row never calls
 * git cherry per branch again.
 *
 * @mutate scripts/scoreboard.mjs |     const unlanded = countUnlanded(refs.filter((r) => !merged.has(r))); |     let unlanded = 0; for (const r of refs) { if (merged.has(r)) continue; if (/^\+/m.test(sh("git", ["cherry", "origin/main", r]))) unlanded++; }
 * @mutate scripts/scoreboard.mjs |  commits.some((c) => !branchIds.has(c) \|\| !mainIds.has(branchIds.get(c))) |  commits.every((c) => !branchIds.has(c) \|\| !mainIds.has(branchIds.get(c)))
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as sb from "../../scripts/scoreboard.mjs";

const countUnlanded = sb.countUnlanded as (refs: string[], run: (c: string, a: string[], o?: { input?: string }) => string) => number;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "sb-branches-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  const commit = (file: string, text: string) => { writeFileSync(join(dir, file), text); git("add", file); git("commit", "-q", "-m", `${file} ${text}`); return git("rev-parse", "HEAD").trim(); };
  commit("base.txt", "base\n");
  git("checkout", "-q", "-b", "landed");
  const a = commit("a.txt", "a\n");
  git("checkout", "-q", "-b", "mixed");
  commit("m.txt", "m\n");
  git("checkout", "-q", "main");
  git("checkout", "-q", "-b", "fresh");
  commit("f.txt", "f\n");
  git("checkout", "-q", "main");
  commit("other.txt", "o\n");
  git("cherry-pick", a); // the 'landed' branch's patch reaches main under a new sha
  for (const b of ["main", "landed", "mixed", "fresh"]) git("update-ref", `refs/remotes/origin/${b}`, b);
  const run = (cmd: string, args: string[], o: { input?: string } = {}) =>
    execFileSync(cmd, args, { cwd: dir, encoding: "utf8", input: o.input, maxBuffer: 1 << 26, stdio: [o.input == null ? "ignore" : "pipe", "pipe", "pipe"] });
  return { dir, git, run };
}

describe("scoreboard remote branches: one batch, git cherry's verdict", () => {
  it("counts exactly the branches git cherry says carry a patch main lacks", () => {
    const { dir, git, run } = repo();
    try {
      const refs = ["origin/landed", "origin/mixed", "origin/fresh"];
      const byCherry = refs.filter((r) => /^\+/m.test(git("cherry", "origin/main", r))).length;
      expect(byCherry, "fixture: git cherry itself sees mixed and fresh as unlanded").toBe(2);
      expect(countUnlanded(refs, run)).toBe(byCherry);
      expect(countUnlanded(["origin/landed"], run), "a cherry-picked branch is landed").toBe(0);
      expect(countUnlanded([], run)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the row never runs git cherry per branch", () => {
    const src = blankComments(readFileSync(join(__dirname, "..", "..", "scripts", "scoreboard.mjs"), "utf8"));
    expect(src).not.toMatch(/"cherry"/);
    expect(src).toMatch(/countUnlanded\(refs\.filter/);
  });
});
