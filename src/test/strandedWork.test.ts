/*
 * GUARD (docs/OPEN.md Q1146; owner 2026-10-03: "nothing should ever be left
 * stranded", "nothing should ever be closed without merging"): work that is
 * not on main is found BY CONTENT wherever it sits.
 *
 * The 2026-10-03 sweep found it in kept local branches, detached worktree
 * HEADs, uncommitted and untracked worktree files, 17 stash entries, origin
 * branches and PRs closed without merging. The tools before it decided "landed"
 * by SHA ancestry, patch-id or subject, or reported to a log nobody read.
 * scripts/stranded-work.mjs + scripts/lib/strandedContent.mjs replace that.
 *
 * Red first: on the 2026-10-03 tree there was no such check at all; the
 * mutations below remove each decision it rests on.
 */
// @mutate scripts/lib/strandedContent.mjs |   return missing > 0 \|\| removedStill >= 5; |   return removedStill >= 5;
// @mutate scripts/lib/strandedContent.mjs | .filter((s) => s && !onMain?.has(s) && !mainIndex.has(s)); | .filter((s) => s && !onMain?.has(s));
// @mutate scripts/lib/strandedContent.mjs |   /^docs\/OPEN\.md$/, |
// @mutate scripts/stranded-work.mjs |     stale: accepted.filter((a) => !itemKeys.has(key(a))), |     stale: [],
// @mutate scripts/stranded-work.mjs |     if (status.some((l) => !l.startsWith("?? "))) { |     if (false) {
// @mutate scripts/stranded-work.mjs |     const fresh = tipHours < STRANDED_AFTER_HOURS; |     const fresh = false;
// @mutate scripts/stranded-work.mjs |     unaccepted: items.filter((i) => !i.fresh && !acceptedKeys.has(key(i))), |     unaccepted: items.filter((i) => !acceptedKeys.has(key(i))),
// @mutate scripts/stranded-work.mjs |     const fresh = tipHours < STRANDED_AFTER_HOURS; |     const fresh = true;
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { buildMainIndex, unlandedContent, isIgnoredPath } from "../../scripts/lib/strandedContent.mjs";
// @ts-expect-error — plain .mjs module, no declaration file
import { localInventory, remoteInventory, judge, makeGit, setMainRef, landedElsewhere } from "../../scripts/stranded-work.mjs";

let root = "";
let repo = "";
let origin = "";
let git: (args: string[], o?: object) => string;
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
const write = (file: string, text: string) => { mkdirSync(join(repo, file, ".."), { recursive: true }); writeFileSync(join(repo, file), text); };
const commit = (msg: string) => { sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", msg); return sh(repo, "rev-parse", "HEAD").trim(); };
const BASE = ["export const a = 'first line of the module';", "export const b = 'second line of the module';",
  "export const c = 'third line of the module';", "export const d = 'fourth line of the module';",
  "export const e = 'fifth line of the module';", "export const f = 'sixth line of the module';", ""].join("\n");

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-stranded-test-")));
  origin = join(root, "origin.git");
  repo = join(root, "work");
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(root, "init", "-q", "-b", "main", repo);
  write("src/a.ts", BASE);
  write("src/other.ts", "export const moved = 'a line that lives in another file';\n");
  write("docs/OPEN.md", "# Open\n");
  commit("base");
  sh(repo, "remote", "add", "origin", origin);
  sh(repo, "push", "-q", "origin", "main");

  // landed-rebased: the same change re-landed on main under a new SHA.
  sh(repo, "switch", "-q", "-c", "landed-rebased");
  write("src/a.ts", BASE + "export const g = 'landed after a rebase';\n");
  commit("landed");
  // unlanded: a line main never got.
  sh(repo, "switch", "-q", "-c", "unlanded", "main");
  write("src/a.ts", BASE + "export const h = 'this line never reached main';\n");
  commit("unlanded");
  // moved: the line exists on main, but in another file.
  sh(repo, "switch", "-q", "-c", "moved", "main");
  write("src/a.ts", BASE + "export const moved = 'a line that lives in another file';\n");
  commit("moved");
  // open-md-only: the open-work list churns on every landing; not work by itself.
  sh(repo, "switch", "-q", "-c", "open-md-only", "main");
  write("docs/OPEN.md", "# Open\n- [x] **Q1 a status note on an item that is long enough**\n");
  commit("open md");
  // deletion: six lines removed that main still has.
  sh(repo, "switch", "-q", "-c", "deletion", "main");
  write("src/a.ts", "\n");
  commit("delete the module body");

  sh(repo, "switch", "-q", "main");
  write("src/a.ts", BASE + "export const g = 'landed after a rebase';\n");
  commit("land it again (rebased)");
  sh(repo, "push", "-q", "origin", "main");

  // A remote branch, and a closed PR's head, with work main lacks.
  sh(repo, "push", "-q", "origin", "unlanded:refs/heads/cloud-session");
  sh(repo, "push", "-q", "origin", "unlanded:refs/pull/7/head");
  sh(repo, "fetch", "-q", "origin");

  // A stash-shaped entry (refs/stash with a reflog), made without `git stash`.
  sh(repo, "switch", "-q", "-c", "stash-src", "main");
  write("src/a.ts", BASE + "export const g = 'landed after a rebase';\nexport const s = 'only in a stash entry';\n");
  const stashed = commit("wip");
  sh(repo, "switch", "-q", "main");
  sh(repo, "update-ref", "--create-reflog", "-m", "On main: wip", "refs/stash", stashed);
  sh(repo, "branch", "-q", "-D", "stash-src");

  // A worktree with an uncommitted edit, an untracked file and an untracked screenshot.
  sh(repo, "worktree", "add", "-q", "--detach", join(root, "wt"), "main");
  writeFileSync(join(root, "wt", "src/a.ts"), BASE + "export const g = 'landed after a rebase';\nexport const u = 'uncommitted in a worktree';\n");
  writeFileSync(join(root, "wt", "notes.md"), "an untracked note\n");
  writeFileSync(join(root, "wt", "shot.png"), "png");

  git = makeGit(repo);
  setMainRef("origin/main");
});
afterAll(() => { setMainRef(null); if (root) rmSync(root, { recursive: true, force: true }); });

// @mutate scripts/stranded-work.mjs |   return bodies.some((b) => | return [].some((b) =>
describe("a closed PR noted as landed elsewhere is not stranded work (2026-10-04)", () => {
  it("accepts the lead's landed notes and nothing else", () => {
    expect(landedElsewhere(["Landed in batch 2 (#2252) as f5a982fdb (Q753, Q510)."])).toBe(true);
    expect(landedElsewhere(["Landed on main as 67e7a5e90 (and e3a1117a7)."])).toBe(true);
    expect(landedElsewhere(["Same work as the earlier cloud PR, already on main through batch 2 (#2252)."])).toBe(true);
    expect(landedElsewhere(["Reopened automatically by branch-prune, which did not read the list. The work is on main."])).toBe(true);
    expect(landedElsewhere(["<!-- auto-generated comment: summarize by coderabbit.ai -->"])).toBe(false);
    expect(landedElsewhere(["closing, will redo later"])).toBe(false);
    expect(landedElsewhere(["Not landed: superseded"])).toBe(false);
    expect(landedElsewhere([])).toBe(false);
  });
});

describe("strandedContent: on main by content, not by SHA or subject", () => {
  it("a branch whose change was re-landed under a new SHA is on main", () => {
    const index = buildMainIndex(git, "origin/main");
    expect(unlandedContent(git, "landed-rebased", "origin/main", index).stranded).toBe(false);
  });
  it("a branch with a line main never got is stranded, and names the file", () => {
    const index = buildMainIndex(git, "origin/main");
    const r = unlandedContent(git, "unlanded", "origin/main", index);
    expect(r.stranded).toBe(true);
    expect(r.files.map((f: { file: string }) => f.file)).toEqual(["src/a.ts"]);
  });
  it("a line that moved to another file on main is on main", () => {
    const index = buildMainIndex(git, "origin/main");
    expect(unlandedContent(git, "moved", "origin/main", index).stranded).toBe(false);
  });
  it("the open-work list and generated files are not work by themselves", () => {
    const index = buildMainIndex(git, "origin/main");
    expect(unlandedContent(git, "open-md-only", "origin/main", index).stranded).toBe(false);
    expect(isIgnoredPath("docs/SCOREBOARD.md")).toBe(true);
    expect(isIgnoredPath("src/lib/x.ts")).toBe(false);
  });
  it("a deletion that never landed is stranded", () => {
    const index = buildMainIndex(git, "origin/main");
    const r = unlandedContent(git, "deletion", "origin/main", index);
    expect(r.removedStill).toBeGreaterThanOrEqual(5);
    expect(r.stranded).toBe(true);
  });
});

describe("stranded-work: every place work sits", () => {
  it("local: branches, stash entries, uncommitted and untracked worktree files (screenshots skipped)", () => {
    const index = buildMainIndex(git, "origin/main");
    const items = localInventory(git, index, { cwdOf: () => [] });
    const ids = items
      .map((i: { kind: string; id: string }) => `${i.kind} ${i.id.replace(root, "").replace(/^stash:[0-9a-f]{12}$/, "stash:<sha>")}`)
      .sort();
    expect(ids).toEqual([
      "branch branch:deletion",
      "branch branch:unlanded",
      "stash stash:<sha>",
      "uncommitted worktree:/wt@uncommitted",
      "untracked worktree:/wt@untracked",
    ]);
    const untracked = items.find((i: { kind: string }) => i.kind === "untracked");
    expect(untracked.files).toEqual(["notes.md"]);
  });
  it("remote: origin branches and PRs closed without merging; merged, dependabot and open-PR branches are not", () => {
    const index = buildMainIndex(git, "origin/main");
    sh(repo, "push", "-q", "origin", "unlanded:refs/heads/in-flight");
    sh(repo, "fetch", "-q", "origin");
    const gh = (argv: string[]) => argv.includes("open")
      ? [{ number: 10, headRefOid: "w", headRefName: "in-flight", createdAt: new Date().toISOString(), title: "landing now", author: { login: "louisianahelpr" } }]
      : argv.includes("closed")
      ? [
          { number: 7, headRefOid: "x", mergedAt: null, closedAt: "2026-10-04T00:00:00Z", author: { login: "louisianahelpr" }, title: "closed unmerged" },
          { number: 8, headRefOid: "y", mergedAt: "2026-10-04T00:00:00Z", closedAt: "2026-10-04T00:00:00Z", author: { login: "louisianahelpr" }, title: "merged" },
          { number: 9, headRefOid: "z", mergedAt: null, closedAt: "2026-10-04T00:00:00Z", author: { login: "app/dependabot" }, title: "bump" },
        ]
      : [];
    // Judged two hours after the push: past STRANDED_AFTER_HOURS.
    const items = remoteInventory(git, index, gh, { now: Date.now() + 2 * 3_600_000 });
    expect(items.map((i: { kind: string; id: string }) => `${i.kind} ${i.id}`).sort()).toEqual([
      "closed-unmerged-pr pr:7",
      "remote-branch remote:origin/cloud-session",
    ]);
    expect(items.some((i: { fresh?: boolean }) => i.fresh)).toBe(false);
  });
  it("a branch pushed under STRANDED_AFTER_HOURS ago is a lane still working: listed fresh, not judged (Q1274)", () => {
    const index = buildMainIndex(git, "origin/main");
    const gh = () => [];
    const items = remoteInventory(git, index, gh);
    const lane = items.find((i: { id: string }) => i.id === "remote:origin/cloud-session");
    expect(lane?.fresh).toBe(true);
    const r = judge(items, []);
    expect(r.unaccepted.map((i: { id: string }) => i.id)).not.toContain("remote:origin/cloud-session");
    expect(r.fresh.map((i: { id: string }) => i.id)).toContain("remote:origin/cloud-session");
    // A park branch pushed again moves its sha: the old acceptance is not stale while the new tip is fresh.
    const moved = judge([{ id: "remote:origin/park", sha: "new", fresh: true }], [{ id: "remote:origin/park", sha: "old" }]);
    expect(moved.stale).toEqual([]);
    expect(moved.unaccepted).toEqual([]);
    // ...and once it is old, it is judged like any other.
    const old = judge([{ id: "remote:origin/park", sha: "new" }], [{ id: "remote:origin/park", sha: "old" }]);
    expect(old.unaccepted.map((i: { id: string }) => i.id)).toEqual(["remote:origin/park"]);
    expect(old.stale.map((i: { id: string }) => i.id)).toEqual(["remote:origin/park"]);
  });
  it("acceptances are exact both ways: a match is excused, a stale one fails", () => {
    const items = [{ id: "pr:7", sha: "aaa" }, { id: "remote:origin/x", sha: "bbb" }];
    const r = judge(items, [{ id: "pr:7", sha: "aaa", reason: "owner decision Q1" }, { id: "pr:99", sha: "ccc", reason: "gone" }]);
    expect(r.unaccepted.map((i: { id: string }) => i.id)).toEqual(["remote:origin/x"]);
    expect(r.stale.map((i: { id: string }) => i.id)).toEqual(["pr:99"]);
  });
});
