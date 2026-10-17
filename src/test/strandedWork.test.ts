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
// @mutate scripts/stranded-work.mjs |     stale: accepted.filter((a) => !itemKeys.has(key(a)) && !freshIds.has(a.id)), |     stale: [],
// @mutate scripts/stranded-work.mjs |     if (status.some((l) => !l.startsWith("?? "))) { |     if (false) {
// @mutate scripts/stranded-work.mjs |     const fresh = tipHours < STRANDED_AFTER_HOURS \|\| |     const fresh = false \|\|
// @mutate scripts/stranded-work.mjs |     unaccepted: items.filter((i) => !i.fresh && !acceptedKeys.has(key(i))), |     unaccepted: items.filter((i) => !acceptedKeys.has(key(i))),
// @mutate scripts/stranded-work.mjs |     const fresh = tipHours < STRANDED_AFTER_HOURS \|\| |     const fresh = true \|\|
// @mutate scripts/stranded-work.mjs |  \|\| waitingForTrain(name.replace( |  && waitingForTrain(name.replace(
// @mutate scripts/stranded-work.mjs |     if (carriedByOpenPr(r)) continue; |
// @mutate scripts/stranded-work.mjs | .filter((l) => l.trim()).map((l) => JSON.parse(l)); | .filter((l) => l.trim()).slice(0, 1).map((l) => JSON.parse(l));
// @mutate scripts/stranded-work.mjs |   const out = gh(["api", "--paginate", | const out = gh(["api", "--search",
// @mutate scripts/stranded-work.mjs | select(.merged_at == null and .closed_at >= "${since}") | select(.merged_at == null)
// @mutate scripts/stranded-work.mjs |   const isRemote = (a) => /^(pr\|remote):/.test(a.id); |   const isRemote = (a) => true;
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMainIndex, unlandedContent, isIgnoredPath } from "../../scripts/lib/strandedContent.mjs";
// @ts-expect-error — plain .mjs module, no declaration file
import { localInventory, remoteInventory, judge, makeGit, setMainRef, landedElsewhere, splitAccepted, closedPullRequests } from "../../scripts/stranded-work.mjs";

/** A fake `gh api --paginate ... --jq <expr>`: runs the REAL jq expression over each page, as gh does. */
function ghPages(pages: object[][]) {
  return (argv: string[], o?: { raw?: boolean }) => {
    const expr = argv[argv.indexOf("--jq") + 1];
    const text = pages.map((pg) => execFileSync("jq", ["-c", expr], { input: JSON.stringify(pg), encoding: "utf8" })).join("");
    return o?.raw ? text : JSON.parse(text);
  };
}

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
  // stranded-staged-new (docs/OPEN.md): a worktree whose ONLY change is a file staged as new.
  sh(repo, "worktree", "add", "-q", "--detach", join(root, "wt-staged"), "main");
  mkdirSync(join(root, "wt-staged", "src"), { recursive: true });
  writeFileSync(join(root, "wt-staged", "src/staged.ts"), "export const staged = 'a new file only staged, never committed';\n");
  sh(join(root, "wt-staged"), "add", "src/staged.ts");

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
      "uncommitted worktree:/wt-staged@uncommitted",
      "uncommitted worktree:/wt@uncommitted",
      "untracked worktree:/wt@untracked",
    ]);
    const untracked = items.find((i: { kind: string }) => i.kind === "untracked");
    expect(untracked.files).toEqual(["notes.md"]);
  });
  // @mutate scripts/stranded-work.mjs |     if (existsSync(realIndex)) copyFileSync(realIndex, env.GIT_INDEX_FILE); |     if (false) copyFileSync(realIndex, env.GIT_INDEX_FILE);
  it("a worktree whose only change is a file STAGED AS NEW is reported, with that file (stranded-staged-new in docs/OPEN.md, 2026-10-17)", () => {
    const index = buildMainIndex(git, "origin/main");
    const items = localInventory(git, index, { cwdOf: () => [] });
    const staged = items.find((i: { id: string }) => i.id === `worktree:${join(root, "wt-staged")}@uncommitted`);
    expect(staged, "the staged-new worktree was not reported").toBeTruthy();
    expect(staged.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(staged.files).toEqual(["src/staged.ts"]);
    expect(staged.missing).toBeGreaterThan(0);
  });
  it("remote: origin branches and PRs closed without merging; merged, dependabot and open-PR branches are not", () => {
    const index = buildMainIndex(git, "origin/main");
    // The open PR carries OTHER work, so it does not cover cloud-session's line.
    sh(repo, "push", "-q", "origin", "deletion:refs/heads/in-flight");
    sh(repo, "fetch", "-q", "origin");
    const gh = (argv: string[], o?: { raw?: boolean }) => argv.includes("open")
      ? [{ number: 10, headRefOid: "w", headRefName: "in-flight", createdAt: new Date().toISOString(), title: "landing now", author: { login: "louisianahelpr" } }]
      : argv[0] === "api" && argv.some((a) => a.includes("state=closed"))
      ? ghPages([[
          { number: 7, head: { sha: "x", ref: "c7" }, merged_at: null, closed_at: "2026-10-04T00:00:00Z", user: { login: "louisianahelpr" }, title: "closed unmerged" },
          { number: 8, head: { sha: "y", ref: "c8" }, merged_at: "2026-10-04T00:00:00Z", closed_at: "2026-10-04T00:00:00Z", user: { login: "louisianahelpr" }, title: "merged" },
        ], [
          { number: 9, head: { sha: "z", ref: "c9" }, merged_at: null, closed_at: "2026-10-04T00:00:00Z", user: { login: "dependabot[bot]" }, title: "bump" },
        ]])(argv, o)
      : [];
    // Judged two hours after the push: past STRANDED_AFTER_HOURS.
    const items = remoteInventory(git, index, gh, { now: Date.now() + 2 * 3_600_000 });
    expect(items.length).toBeGreaterThan(1);
    expect(items.map((i: { kind: string; id: string }) => `${i.kind} ${i.id}`).sort()).toEqual([
      "closed-unmerged-pr pr:7",
      "remote-branch remote:origin/cloud-session",
    ]);
    expect(items.some((i: { fresh?: boolean }) => i.fresh)).toBe(false);
  });
  it("one landing path (2026-10-13): a ready/* branch waits 24 h for the train, and content an open train PR carries is not stranded", () => {
    const index = buildMainIndex(git, "origin/main");
    sh(repo, "push", "-q", "origin", "unlanded:refs/heads/ready/lane-1");
    sh(repo, "fetch", "-q", "origin");
    const noPrs = (_argv: string[], o?: { raw?: boolean }) => (o?.raw ? "" : []);
    const at = (h: number) => remoteInventory(git, index, noPrs, { now: Date.now() + h * 3_600_000 });
    const lane = (items: { id: string; fresh?: boolean }[]) => items.find((i) => i.id === "remote:origin/ready/lane-1");
    // Two hours after the push: past STRANDED_AFTER_HOURS, still inside the train's 24 h.
    expect(lane(at(2))?.fresh).toBe(true);
    expect(judge(at(2), []).unaccepted.map((i: { id: string }) => i.id)).not.toContain("remote:origin/ready/lane-1");
    // A queue that stalled a day IS a finding.
    expect(lane(at(25))?.fresh).toBeUndefined();
    expect(judge(at(25), []).unaccepted.map((i: { id: string }) => i.id)).toContain("remote:origin/ready/lane-1");
    // An open train PR carrying the same content: the train lands it; neither branch is listed.
    sh(repo, "push", "-q", "origin", "unlanded:refs/heads/land/train-x");
    sh(repo, "fetch", "-q", "origin");
    const trainOpen = (argv: string[], o?: { raw?: boolean }) => argv.includes("open")
      ? [{ number: 11, headRefOid: "t", headRefName: "land/train-x", createdAt: new Date().toISOString(), title: "train", author: { login: "louisianahelpr" } }]
      : (o?.raw ? "" : []);
    const items = remoteInventory(git, index, trainOpen, { now: Date.now() + 25 * 3_600_000 });
    const ids = items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain("remote:origin/ready/lane-1");
    expect(ids).not.toContain("remote:origin/cloud-session");
    // ...while other work the train does not carry still is (deletion's six removed lines).
    sh(repo, "push", "-q", "origin", "deletion:refs/heads/ready/lane-2");
    sh(repo, "fetch", "-q", "origin");
    const after = remoteInventory(git, index, trainOpen, { now: Date.now() + 25 * 3_600_000 }).map((i: { id: string }) => i.id);
    expect(after).toContain("remote:origin/ready/lane-2");
    for (const ref of ["ready/lane-1", "ready/lane-2", "land/train-x"]) sh(repo, "push", "-q", "origin", `:refs/heads/${ref}`);
    sh(repo, "fetch", "-q", "--prune", "origin");
  });
  it("closed PRs come from the REST pulls list, every page, never GitHub search (Q1376: search left out 14 of 130, #2444 and #2385 among them)", () => {
    const calls: string[][] = [];
    const pages = ghPages([
      [{ number: 2444, head: { sha: "c897919a", ref: "q975-red-proof" }, merged_at: null, closed_at: "2026-10-06T06:54:06Z", user: { login: "louisianahelpr" }, title: "red proof" },
        { number: 2400, head: { sha: "m", ref: "merged" }, merged_at: "2026-10-06T00:00:00Z", closed_at: "2026-10-06T00:00:00Z", user: { login: "louisianahelpr" }, title: "merged" }],
      [{ number: 2385, head: { sha: "31bf45af", ref: "chore/generated-files-main-bot" }, merged_at: null, closed_at: "2026-10-06T19:42:01Z", user: { login: "louisianahelpr" }, title: "wip" },
        { number: 1900, head: { sha: "old", ref: "old" }, merged_at: null, closed_at: "2026-09-20T00:00:00Z", user: { login: "louisianahelpr" }, title: "before the rule" }],
    ]);
    const gh = (argv: string[], o?: { raw?: boolean }) => { calls.push(argv); return pages(argv, o); };
    const prs = closedPullRequests(gh, "2026-10-03T00:00:00Z");
    expect(prs.length).toBeGreaterThan(1);
    // Every page, unmerged and closed since the rule only, already trimmed by gh's jq (sentry review on #2813: the raw list was 39.7 MB).
    expect(prs.map((p: { number: number; headRefOid: string }) => `${p.number}@${p.headRefOid}`)).toEqual(["2444@c897919a", "2385@31bf45af"]);
    expect(Object.keys(prs[0]).sort()).toEqual(["author", "closedAt", "headRefName", "headRefOid", "mergedAt", "number", "title"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["api", "--paginate"]);
    expect(calls[0].join(" ")).toContain("state=closed");
    expect(calls[0]).not.toContain("--search");
    expect(() => closedPullRequests(() => ({ message: "Not Found" }))).toThrow(/text/);
  });
  it("a branch pushed under STRANDED_AFTER_HOURS ago is a lane still working: listed fresh, not judged (Q1274)", () => {
    const index = buildMainIndex(git, "origin/main");
    const gh = (_argv: string[], o?: { raw?: boolean }) => (o?.raw ? "" : []);
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
  it("a LOCAL acceptance (branch:, worktree:) is judged only against local items, never as a stale remote one", () => {
    const accepted = [
      { id: "pr:7", sha: "aaa", reason: "superseded" },
      { id: "branch:old-lane", sha: "ddd", reason: "landed another way, Q1" },
      { id: "worktree:/x@HEAD", sha: "eee", reason: "superseded" },
    ];
    const { remote, local } = splitAccepted(accepted);
    expect(remote.map((a: { id: string }) => a.id)).toEqual(["pr:7"]);
    expect(local.map((a: { id: string }) => a.id)).toEqual(["branch:old-lane", "worktree:/x@HEAD"]);
    // CI (--remote --check) sees the remote half only: no stale acceptance from a Mac-only branch.
    expect(judge([{ id: "pr:7", sha: "aaa" }], remote).stale).toEqual([]);
    // On the Mac: an accepted local branch is excused, an unaccepted one is not, a moved one is stale.
    const l = judge([{ id: "branch:old-lane", sha: "ddd" }, { id: "branch:new-work", sha: "fff" }], local);
    expect(l.unaccepted.map((i: { id: string }) => i.id)).toEqual(["branch:new-work"]);
    expect(l.stale.map((i: { id: string }) => i.id)).toEqual(["worktree:/x@HEAD"]);
  });
});
