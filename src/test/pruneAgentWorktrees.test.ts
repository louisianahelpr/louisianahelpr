/*
 * GUARD (Q77): finished agents' LOCKED worktrees under .claude/worktrees/ are
 * unlocked and removed by the session-start hygiene script; unmerged ones are
 * reported, never deleted; the main checkout is never a candidate.
 * Runs scripts/lib/worktreeHygiene.mjs against a real fixture repo (bare
 * origin + clone + linked worktrees), with the process-cwd list and the pid
 * liveness probe injected.
 */
// @mutate scripts/lib/worktreeHygiene.mjs |   if (f.locked && !f.agentOwned) return | if (f.locked) return
// @mutate scripts/lib/worktreeHygiene.mjs |   const merged = f.ahead === 0 \|\| f.allUpstream === true; |   const merged = true;
// @mutate scripts/lib/worktreeHygiene.mjs |   if (f.dirty > 0) return { action: hold, | if (false) return { action: hold,
// @mutate scripts/lib/worktreeHygiene.mjs |   if (f.cwdInside) return | if (false) return
// @mutate scripts/lib/worktreeHygiene.mjs |   if (f.locked && f.lockPid !== null && f.lockPidAlive) { |   if (false) {
// @mutate scripts/lib/worktreeHygiene.mjs |   if (f.ageMs < minAgeMs) { |   if (false) {
// @mutate scripts/lib/worktreeHygiene.mjs |     if (i === 0 \|\| protectedPaths.has(p)) return; |     if (protectedPaths.has("never")) return;
// @mutate scripts/lib/worktreeHygiene.mjs |   const cwdInside = (p) => o.cwds === null \|\| | const cwdInside = (p) => false \|\|
// @mutate scripts/lib/worktreeHygiene.mjs |   const hold = f.locked ? "report" : "skip"; |   const hold = "skip";
// @mutate scripts/lib/worktreeHygiene.mjs |     if (r.unlock) {\n      const u = |     if (false) {\n      const u =
// @mutate scripts/prune-git-hygiene.mjs |   const plan = planWorktreeCleanup(process.cwd(), { cwds, | const plan = planWorktreeCleanup(process.cwd(), { cwds: null,
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import {
  planWorktreeCleanup,
  applyWorktreePlan,
  lockPid,
  type WorktreePlan,
} from "../../scripts/lib/worktreeHygiene.mjs";

const H = 3600_000;
let root = "";
let main = "";
const agent = (n: string) => join(main, ".claude", "worktrees", n);

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
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-q", "-m", file);
}
function addWorktree(path: string, branch: string, lockReason?: string) {
  git(main, "worktree", "add", "-q", "-b", branch, path, "origin/main");
  if (lockReason !== undefined) git(main, "worktree", "lock", "--reason", lockReason, path);
}
const names = (xs: { path: string }[]) => xs.map((x) => basename(x.path)).sort();
const reasonOf = (xs: { path: string; reason: string }[], n: string) => xs.find((x) => basename(x.path) === n)?.reason;
const plan = (o: Partial<Parameters<typeof planWorktreeCleanup>[1]> = {}): WorktreePlan =>
  planWorktreeCleanup(main, {
    cwds: [join(agent("agent-busy"), "src")],
    nowMs: Date.now() + 3 * H,
    minAgeMs: 2 * H,
    pidAlive: (pid) => pid === 4242,
    ...o,
  });

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-q77-")));
  const origin = join(root, "origin.git");
  main = join(root, "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "checkout", "-q", "-b", "main");
  commit(main, "a.txt", "a\n");
  git(main, "push", "-q", "origin", "main");
  git(main, "fetch", "-q", "origin");

  // Finished agent, nothing beyond origin/main, lock names a dead pid: REMOVE.
  addWorktree(agent("agent-done"), "agent-done", "claude agent agent-done (pid 999999)");
  // Finished agent whose commit landed on main by cherry-pick (new sha, same patch): REMOVE.
  addWorktree(agent("agent-cherry"), "agent-cherry", "claude agent");
  commit(agent("agent-cherry"), "c.txt", "c\n");
  git(main, "-c", "commit.gpgsign=false", "cherry-pick", "agent-cherry");
  git(main, "push", "-q", "origin", "main");
  git(main, "fetch", "-q", "origin");
  // Agent with a commit NOT on main: REPORT, never delete.
  addWorktree(agent("agent-unmerged"), "agent-unmerged", "claude agent");
  commit(agent("agent-unmerged"), "u.txt", "u\n");
  // Agent with uncommitted work: REPORT.
  addWorktree(agent("agent-dirty"), "agent-dirty", "claude agent");
  writeFileSync(join(agent("agent-dirty"), "wip.txt"), "wip\n");
  // A process still has its cwd inside it: SKIP.
  addWorktree(agent("agent-busy"), "agent-busy", "claude agent");
  mkdirSync(join(agent("agent-busy"), "src"));
  // Its lock holder is still running: SKIP.
  addWorktree(agent("agent-live"), "agent-live", "claude agent agent-live (pid 4242)");
  // Locked OUTSIDE .claude/worktrees: the old rule, SKIP as locked.
  addWorktree(join(root, "elsewhere"), "elsewhere", "someone's own lock");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("finished agent worktrees are cleaned up (Q77)", () => {
  it("the fixture holds every case, and the main checkout is never a candidate", () => {
    const p = plan();
    expect(p.entries.length).toBeGreaterThan(7);
    const all = [...p.remove, ...p.report, ...p.skip].map((x) => resolve(x.path));
    expect(all).toHaveLength(p.entries.length - 1);
    expect(all).not.toContain(resolve(main));
  });

  it("removes (unlocking first) only merged, idle, old agent worktrees", () => {
    const p = plan();
    expect(names(p.remove)).toEqual(["agent-cherry", "agent-done"]);
    expect(p.remove.every((r) => r.unlock)).toBe(true);
  });

  it("REPORTS unmerged commits and uncommitted work, never removes them", () => {
    const p = plan();
    expect(names(p.report)).toEqual(["agent-dirty", "agent-unmerged"]);
    expect(reasonOf(p.report, "agent-unmerged")).toMatch(/1 commit\(s\) not in origin\/main/);
    expect(reasonOf(p.report, "agent-dirty")).toMatch(/uncommitted/);
  });

  it("skips a worktree a process is inside, one whose lock holder runs, and foreign locks", () => {
    const p = plan();
    expect(reasonOf(p.skip, "agent-busy")).toMatch(/cwd inside it/);
    expect(reasonOf(p.skip, "agent-live")).toMatch(/pid 4242/);
    expect(reasonOf(p.skip, "elsewhere")).toBe("locked");
  });

  it("removes nothing younger than 2h, and nothing when process cwds are unknown", () => {
    expect(plan({ nowMs: Date.now() }).remove).toEqual([]);
    expect(plan({ cwds: null }).remove).toEqual([]);
  });

  it("reads the pid out of a lock reason", () => {
    expect(lockPid("claude agent agent-x (pid 1234)")).toBe(1234);
    expect(lockPid("claude agent")).toBeNull();
  });

  it("applying the plan deletes exactly the removable ones and leaves main and the rest", () => {
    const p = plan();
    const res = applyWorktreePlan(main, p);
    expect(res.refused).toEqual([]);
    expect(res.removed.map((x) => basename(x)).sort()).toEqual(["agent-cherry", "agent-done"]);
    expect(existsSync(agent("agent-done"))).toBe(false);
    expect(existsSync(agent("agent-cherry"))).toBe(false);
    for (const n of ["agent-unmerged", "agent-dirty", "agent-busy", "agent-live"]) expect(existsSync(agent(n))).toBe(true);
    expect(existsSync(join(main, "a.txt"))).toBe(true);
    // the reported one is still locked
    expect(git(main, "worktree", "list", "--porcelain")).toMatch(/agent-unmerged\n[^]*?locked claude agent/);
  });

  it("the session-start hygiene script uses the rule with the real process cwds", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-git-hygiene.mjs"), "utf8");
    expect(src).toMatch(/planWorktreeCleanup\(process\.cwd\(\), \{ cwds, /);
    expect(src).toMatch(/applyWorktreePlan\(process\.cwd\(\), plan\)/);
    expect(src).toMatch(/for \(const r of plan\.report\) say/);
  });
});
