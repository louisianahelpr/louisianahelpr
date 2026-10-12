/*
 * GUARD (owner standing order, 2026-10-03: "nothing is left stranded, and
 * nothing is closed without merging"): what counts as LANDED is decided by
 * CONTENT, the same scripts/lib/strandedContent.mjs test `npm run stranded`
 * uses, in all three cleaners:
 *   - scripts/prune-git-hygiene.mjs (local branches: lib/branchHygiene.mjs;
 *     worktrees: lib/worktreeHygiene.mjs). Measured 2026-10-12: it kept 118
 *     branches because a commit's patch-id was not on origin/main, while
 *     `stranded-work.mjs --local` found lines off main in only 94 items, so
 *     branches whose content had landed (by hand, squashed, split, edited on
 *     the way) were never cleaned and the list never shrank.
 *   - scripts/prune-stale-branches.mjs (branch-prune.yml): it opened an
 *     auto-land PR for origin/fix/no-false-signout three times (#2696, #2707,
 *     #2712) after its work merged via #2689, because its two leftover commits
 *     (a regenerated-inventory refresh, a superseded coverage-floor bump) never
 *     match by patch.
 * And the other way: a branch with ONE added line not on main, one short
 * changed line, or a deletion main never took is KEPT.
 *
 * Red first: on the old rules the content-landed branch, worktree and the
 * no-false-signout branch are all kept / auto-landed (the mutations below).
 */
// @mutate scripts/lib/branchHygiene.mjs |   const landed = f.merged \|\| f.unlanded === 0 \|\| f.contentLanded === true; |   const landed = f.merged \|\| f.unlanded === 0;
// @mutate scripts/lib/branchHygiene.mjs |         cLanded = contentLanded(r); |         cLanded = !r.stranded;
// @mutate scripts/lib/branchHygiene.mjs |   if (f.name.startsWith("claim/")) return | if (false) return
// @mutate scripts/lib/worktreeHygiene.mjs |   const merged = f.ahead === 0 \|\| f.allUpstream === true \|\| f.contentLanded === true; |   const merged = f.ahead === 0 \|\| f.allUpstream === true;
// @mutate scripts/lib/strandedContent.mjs |   return !r.error && r.mergeBase !== null && r.missing === 0 && r.removedStill === 0 && r.shortMissing === 0; |   return !r.error && r.mergeBase !== null && r.missing === 0;
// @mutate scripts/lib/strandedContent.mjs |         if (t && !sigLine(t) && !/^[\])}{(;,]*$/.test(t) && !onMain?.has(t)) fileShort.push(t); |         if (false) fileShort.push(t);
// @mutate scripts/prune-stale-branches.mjs |   if (contentOnMain) return false; |
// @mutate scripts/prune-git-hygiene.mjs |   const bplan = planBranchCleanup(process.cwd(), { checkedOut, base: BASE, minAgeMs: MIN_AGE_MS, outOfTime, contentOf }); |   const bplan = planBranchCleanup(process.cwd(), { checkedOut, base: BASE, minAgeMs: MIN_AGE_MS, outOfTime, contentOf: () => ({ error: "off" }) });
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { planBranchCleanup, applyBranchPlan, type BranchPlan } from "../../scripts/lib/branchHygiene.mjs";
import { planWorktreeCleanup } from "../../scripts/lib/worktreeHygiene.mjs";
import { buildMainIndex, unlandedContent, gitRunner } from "../../scripts/lib/strandedContent.mjs";
import { findStranded } from "../../scripts/prune-stale-branches.mjs";

const H = 3600_000;
let root = "";
let main = "";
const wtPath = () => join(root, "wt-relanded");

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
function write(file: string, body: string) {
  mkdirSync(dirname(join(main, file)), { recursive: true });
  writeFileSync(join(main, file), body);
}
function commit(msg: string) {
  git(main, "add", "-A");
  git(main, "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg);
}

const BASE = [
  "export const alpha = 'the first line of the module';",
  "export const beta = 'the second line of the module';",
  "export const gamma = 'the third line of the module';",
  "x = 1;",
  "",
].join("\n");
const FEATURE = "export function feature() { return 'a feature that landed'; }\n";

const plan = (o: Partial<Parameters<typeof planBranchCleanup>[1]> = {}): BranchPlan =>
  planBranchCleanup(main, { checkedOut: new Set(["main"]), nowMs: Date.now() + 3 * H, minAgeMs: 2 * H, ...o });
const deleted = (p: BranchPlan) => p.delete.map((d) => d.branch).sort();
const skipReason = (p: BranchPlan, b: string) => p.skip.find((s) => s.branch === b)?.reason;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-prune-content-")));
  const origin = join(root, "origin.git");
  main = join(root, "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "checkout", "-q", "-b", "main");
  write("src/a.ts", BASE);
  write("docs/GUARD-BURNDOWN.md", "score 10\n");
  write("scripts/coverage-baseline.json", '{ "src/lib": 79.5 }\n');
  commit("base");
  git(main, "push", "-q", "origin", "main");

  // relanded: the feature, in two commits. main later takes the SAME content in
  // one squashed commit that also carries other work, so no patch-id matches.
  git(main, "checkout", "-q", "-b", "relanded", "main");
  write("src/a.ts", BASE + FEATURE);
  commit("feature part 1");
  write("src/a.ts", BASE.replace("x = 1;", "x = 2;") + FEATURE);
  commit("feature part 2 (a short line)");

  // one-line-left: the same, plus ONE significant line main never got.
  git(main, "checkout", "-q", "-b", "one-line-left", "relanded");
  write("src/a.ts", BASE.replace("x = 1;", "x = 2;") + FEATURE + "export const lost = 'this line never reached main';\n");
  commit("one unlanded line");
  // short-left: the same, plus a SHORT changed line main never got.
  git(main, "checkout", "-q", "-b", "short-left", "relanded");
  write("src/a.ts", BASE.replace("x = 1;", "x = 3;") + FEATURE);
  commit("a short change");
  // deletion-left: removes one significant line main still has (under the
  // stranded report's 5-line floor, still never deleted by hygiene).
  git(main, "checkout", "-q", "-b", "deletion-left", "relanded");
  write("src/a.ts", BASE.replace("x = 1;", "x = 2;").replace("export const gamma = 'the third line of the module';\n", "") + FEATURE);
  commit("drop gamma");
  // claim/*: a lane's lock, content-landed or not, is never touched.
  git(main, "branch", "claim/some-lane", "relanded");

  // fix/no-false-signout's shape: its work landed (a squash under a new patch),
  // what is left by identity is a generated-inventory refresh and a coverage
  // floor bump main superseded.
  git(main, "checkout", "-q", "-b", "fix/no-false-signout", "main");
  write("src/auth.ts", "export const sessionNet = 'only the auth server refusal signs a member out';\n");
  commit("fix(auth): a network blip never signs a member out");
  write("docs/GUARD-BURNDOWN.md", "score 11\n");
  commit("chore(refresh): generated inventories regenerated for the session-lost guard");
  write("scripts/coverage-baseline.json", '{ "src/lib": 80.08 }\n');
  commit("chore(coverage): raise the src/lib floor to the measured 80.08%");
  // A control: a pushed branch with real work that never landed.
  git(main, "checkout", "-q", "-b", "really-stranded", "main");
  write("src/lost.ts", "export const lostWork = 'work that is on neither main nor a PR';\n");
  commit("feat: work that never landed");

  // main takes relanded's and no-false-signout's content in one squashed commit.
  git(main, "checkout", "-q", "main");
  write("src/a.ts", BASE.replace("x = 1;", "x = 2;") + FEATURE);
  write("src/auth.ts", "export const sessionNet = 'only the auth server refusal signs a member out';\n");
  write("src/other.ts", "export const other = 'unrelated work squashed in the same commit';\n");
  write("docs/GUARD-BURNDOWN.md", "score 12\n");
  write("scripts/coverage-baseline.json", '{ "src/lib": 81.2 }\n');
  commit("squash: feature + session net + other work");
  git(main, "push", "-q", "origin", "main", "fix/no-false-signout", "really-stranded");
  git(main, "fetch", "-q", "origin");

  // A finished worktree whose HEAD is relanded's tip (detached, clean).
  git(main, "worktree", "add", "-q", "--detach", wtPath(), git(main, "rev-parse", "relanded"));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("hygiene decides LANDED by content", () => {
  it("the fixture is the failing shape: patch-ids say relanded is NOT on main", () => {
    const cherry = git(main, "cherry", "origin/main", "relanded").split("\n");
    expect(cherry.length).toBeGreaterThan(1);
    expect(cherry.every((l) => l.startsWith("+"))).toBe(true);
    const p = plan();
    expect(p.delete.length + p.skip.length).toBeGreaterThan(5);
  });

  it("a content-landed branch is deleted (how: content); a claim/* branch never is", () => {
    const p = plan();
    // fix/no-false-signout's leftovers are generated files only (GUARD-BURNDOWN,
    // a *baseline.json): its content is on main, so locally it goes too.
    expect(deleted(p)).toEqual(["fix/no-false-signout", "relanded"]);
    expect(p.delete.every((d) => d.how === "content")).toBe(true);
    expect(skipReason(p, "claim/some-lane")).toMatch(/claim/);
  });

  it("a branch with one unlanded line, a short changed line, or an unlanded deletion is kept, and says why", () => {
    const p = plan();
    expect(skipReason(p, "one-line-left")).toMatch(/not on origin\/main.*by content: 1 line\(s\) not on main in src\/a\.ts/);
    expect(skipReason(p, "short-left")).toMatch(/by content: 1 short line/);
    expect(skipReason(p, "deletion-left")).toMatch(/by content: 1 deleted line\(s\) still on main/);
  });

  it("the age gate and the checked-out rule still hold for a content-landed branch", () => {
    expect(deleted(plan({ nowMs: Date.now() }))).toEqual([]);
    expect(skipReason(plan({ checkedOut: new Set(["main", "relanded"]) }), "relanded")).toBe("checked out in a worktree");
  });

  it("applying deletes it with a compare-and-delete, leaving every unlanded branch", () => {
    const r = applyBranchPlan(main, plan());
    expect(r.refused).toEqual([]);
    expect(r.deleted.sort()).toEqual(["fix/no-false-signout", "relanded"]);
    const left = git(main, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n");
    for (const b of ["one-line-left", "short-left", "deletion-left", "claim/some-lane", "really-stranded"]) {
      expect(left).toContain(b);
    }
  });

  it("a clean worktree whose HEAD is content-landed is removed; the same HEAD with an uncommitted file is not", () => {
    const wp = (o: Partial<Parameters<typeof planWorktreeCleanup>[1]> = {}) =>
      planWorktreeCleanup(main, { cwds: [], nowMs: Date.now() + 3 * H, minAgeMs: 2 * H, ...o });
    expect(wp().remove.map((r) => basename(r.path))).toEqual(["wt-relanded"]);
    writeFileSync(join(wtPath(), "scratch.ts"), "export const wip = 'uncommitted work in progress';\n");
    const p = wp();
    expect(p.remove).toEqual([]);
    expect(p.skip.find((s) => basename(s.path) === "wt-relanded")?.reason).toMatch(/uncommitted/);
    rmSync(join(wtPath(), "scratch.ts"));
  });

  it("the hygiene script hands the content judge to both planners", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-git-hygiene.mjs"), "utf8");
    expect(src).toMatch(/const contentOf = makeContentJudge\(process\.cwd\(\), BASE\);/);
    expect(src).toMatch(/planWorktreeCleanup\(process\.cwd\(\), \{[^}]*contentOf \}\)/);
    expect(src).toMatch(/planBranchCleanup\(process\.cwd\(\), \{[^}]*contentOf \}\)/);
  });
});

describe("branch-prune opens no auto-land PR for a branch whose content is on main", () => {
  const branches = () =>
    ["fix/no-false-signout", "really-stranded"].map((name) => ({ name, sha: git(main, "rev-parse", `origin/${name}`), ageHours: 5 }));
  const contentStrandedOf = () => {
    const run = gitRunner(main);
    const index = buildMainIndex(run, "origin/main");
    return (name: string) => unlandedContent(run, `origin/${name}`, "origin/main", index).stranded;
  };
  const gitFn = (args: string[]) => git(main, ...args);

  it("the fixture is the #2696/#2707/#2712 shape: two commits are still '+' by patch-id", () => {
    const plus = git(main, "cherry", "origin/main", "origin/fix/no-false-signout").split("\n").filter((l) => l.startsWith("+"));
    expect(plus.length).toBeGreaterThan(1);
  });

  it("fix/no-false-signout is content-on-main, not stranded; real unlanded work still is", () => {
    const r = findStranded(gitFn, branches(), new Set(), new Map(), contentStrandedOf());
    expect(r.stranded.map((b) => b.name)).toEqual(["really-stranded"]);
    expect(r.contentOnMain.map((b) => b.name)).toEqual(["fix/no-false-signout"]);
  });

  it("the script's main() goes through findStranded", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-stale-branches.mjs"), "utf8");
    expect(src).toMatch(/const \{ stranded, contentOnMain \} = findStranded\(git, branches, openHeads, readAcceptedTips\(\), contentStrandedOf\);/);
  });
});
