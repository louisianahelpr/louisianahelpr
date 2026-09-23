/**
 * Which linked worktrees scripts/prune-git-hygiene.mjs may remove (Q77).
 *
 * WHY. Every worktree-isolated agent leaves a LOCKED worktree under
 * .claude/worktrees/ when it finishes, and the hygiene script skipped every
 * locked worktree (a running agent locks its own), so they piled up. A locked
 * worktree under <main>/.claude/worktrees/ is now unlocked and removed once its
 * agent has provably finished:
 *   - its HEAD has no commit outside origin/main (`rev-list --count` is 0, or
 *     `git cherry` shows every commit already upstream by patch-id);
 *   - `git status --porcelain` is empty (tracked AND untracked);
 *   - no process has its cwd inside it (lsof/ps, injected by the caller);
 *   - the pid named in its lock reason, if any, is not running;
 *   - it was last touched more than MIN_AGE ago.
 * A locked agent worktree with unmerged commits or uncommitted work is
 * REPORTED (it may be lost work), never deleted. The main checkout is never a
 * candidate and is never reported. Locked worktrees anywhere else keep the old
 * rule: skipped. Removal is `git worktree remove` WITHOUT --force.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export const AGENT_WORKTREE_DIR = join(".claude", "worktrees");

/** Parse `git worktree list --porcelain`. The first entry is the main worktree. */
export function parseWorktrees(porcelain) {
  const list = [];
  let cur = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), locked: false, lockReason: "", prunable: false, branch: null, bare: false };
      list.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "locked" || line.startsWith("locked ")) {
      cur.locked = true;
      cur.lockReason = line.slice(7);
    } else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
    else if (line === "bare") cur.bare = true;
  }
  return list;
}

/** The pid named in a lock reason ("... pid 1234 ..."), or null. */
export function lockPid(reason) {
  const m = /\bpid[ :=]?(\d+)\b/i.exec(reason || "");
  return m ? Number(m[1]) : null;
}

/**
 * Decide one linked worktree from facts gathered by the caller.
 * @returns {{action: "remove" | "report" | "skip", unlock?: boolean, reason?: string}}
 */
export function classifyWorktree(f, minAgeMs) {
  if (f.bare) return { action: "skip", reason: "bare" };
  if (f.locked && !f.agentOwned) return { action: "skip", reason: "locked" };
  if (f.prunable || !f.exists) return { action: "skip", reason: "directory missing (left to `git worktree prune`)" };
  const hold = f.locked ? "report" : "skip";
  if (f.statusError) return { action: "skip", reason: `git status failed: ${f.statusError}` };
  if (f.dirty > 0) return { action: hold, reason: `uncommitted/untracked changes (${f.dirty} path(s))` };
  if (f.ahead === null) return { action: "skip", reason: "rev-list failed" };
  const merged = f.ahead === 0 || f.allUpstream === true;
  if (!merged) return { action: hold, reason: `${f.ahead} commit(s) not in origin/main` };
  if (f.cwdInside) return { action: "skip", reason: "a running process has its cwd inside it" };
  if (f.locked && f.lockPid !== null && f.lockPidAlive) {
    return { action: "skip", reason: `its lock holder (pid ${f.lockPid}) is still running` };
  }
  if (f.ageMs === null) return { action: "skip", reason: "cannot read its age" };
  if (f.ageMs < minAgeMs) {
    return { action: "skip", reason: `touched ${Math.round(f.ageMs / 60_000)}m ago (< ${minAgeMs / 60_000}m)` };
  }
  return { action: "remove", unlock: f.locked };
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

function gitIn(cwd, argv, timeout = 30_000) {
  try {
    const out = execFileSync("git", argv, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      // GIT_OPTIONAL_LOCKS=0: `git status` must not refresh the index, or it would
      // bump the very mtime the age check reads.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim().split("\n")[0] };
  }
}

/** Youngest of: the worktree's `.git` file, its admin dir's HEAD and index. */
function worktreeAgeMs(path, nowMs) {
  const stamps = [];
  const add = (f) => {
    try {
      stamps.push(statSync(f).mtimeMs);
    } catch {
      /* missing: not a stamp */
    }
  };
  add(join(path, ".git"));
  const gd = gitIn(path, ["rev-parse", "--absolute-git-dir"]);
  if (gd.ok) {
    add(join(gd.out, "HEAD"));
    add(join(gd.out, "index"));
  }
  return stamps.length ? nowMs - Math.max(...stamps) : null;
}

/** Default liveness probe: signal 0 (EPERM still means it exists). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/**
 * Plan the worktree cleanup for the repo at `repo`.
 * @param {string} repo any path inside the repo
 * @param {object} o
 * @param {string[] | null} o.cwds every running process's cwd; null = unknown (removes nothing)
 * @param {number} [o.nowMs]
 * @param {number} [o.minAgeMs]
 * @param {string} [o.base]
 * @param {(pid: number) => boolean} [o.pidAlive]
 * @param {() => boolean} [o.outOfTime]
 */
export function planWorktreeCleanup(repo, o) {
  const nowMs = o.nowMs ?? Date.now();
  const minAgeMs = o.minAgeMs ?? 120 * 60_000;
  const base = o.base ?? "origin/main";
  const alive = o.pidAlive ?? pidAlive;
  const common = gitIn(repo, ["rev-parse", "--git-common-dir"]);
  if (!common.ok) throw new Error(`not a git repo: ${common.out}`);
  const commonDir = real(resolve(repo, common.out));
  const list = gitIn(repo, ["worktree", "list", "--porcelain"]);
  if (!list.ok) throw new Error(`git worktree list failed: ${list.out}`);
  const entries = parseWorktrees(list.out);
  const mainPath = entries[0] ? real(entries[0].path) : null;
  const protectedPaths = new Set([mainPath, real(dirname(commonDir))].filter(Boolean));
  const agentRoot = mainPath ? join(mainPath, AGENT_WORKTREE_DIR) + sep : null;
  const cwdInside = (p) => o.cwds === null || o.cwds.some((c) => c === p || c.startsWith(p + sep));

  const plan = { entries, remove: [], report: [], skip: [] };
  entries.forEach((wt, i) => {
    const p = real(wt.path);
    if (i === 0 || protectedPaths.has(p)) return; // main: never a candidate, not even reported
    if (o.outOfTime?.()) {
      plan.skip.push({ path: wt.path, reason: "time box reached" });
      return;
    }
    const exists = existsSync(wt.path);
    const f = {
      bare: wt.bare,
      locked: wt.locked,
      agentOwned: agentRoot !== null && p.startsWith(agentRoot),
      prunable: wt.prunable,
      exists,
      dirty: 0,
      statusError: null,
      ahead: null,
      allUpstream: false,
      cwdInside: false,
      lockPid: lockPid(wt.lockReason),
      lockPidAlive: false,
      ageMs: null,
    };
    if (exists && !wt.bare && !wt.prunable && (!wt.locked || f.agentOwned)) {
      f.ageMs = worktreeAgeMs(wt.path, nowMs); // read BEFORE any other git command touches the tree
      const st = gitIn(wt.path, ["status", "--porcelain", "--untracked-files=all"]);
      if (!st.ok) f.statusError = st.out;
      else f.dirty = st.out ? st.out.split("\n").length : 0;
      const ahead = gitIn(wt.path, ["rev-list", "--count", `${base}..HEAD`]);
      if (ahead.ok) f.ahead = Number(ahead.out);
      if (f.ahead > 0) {
        const ch = gitIn(wt.path, ["cherry", base, "HEAD"]);
        f.allUpstream = ch.ok && ch.out !== "" && ch.out.split("\n").every((l) => l.startsWith("-"));
      }
      f.cwdInside = cwdInside(p);
      f.lockPidAlive = f.lockPid !== null && alive(f.lockPid);
    }
    const d = classifyWorktree(f, minAgeMs);
    if (d.action === "remove") plan.remove.push({ path: wt.path, branch: wt.branch, unlock: d.unlock });
    else plan[d.action].push({ path: wt.path, branch: wt.branch, reason: d.reason });
  });
  return plan;
}

/** Carry out plan.remove: unlock if needed, then `git worktree remove` (never --force). */
export function applyWorktreePlan(repo, plan) {
  const removed = [];
  const refused = [];
  for (const r of plan.remove) {
    if (r.unlock) {
      const u = gitIn(repo, ["worktree", "unlock", r.path]);
      if (!u.ok) {
        refused.push({ path: r.path, reason: `git unlock refused: ${u.out}` });
        continue;
      }
    }
    const rm = gitIn(repo, ["worktree", "remove", r.path]); // NO --force, ever
    if (rm.ok) removed.push(r.path);
    else {
      if (r.unlock) gitIn(repo, ["worktree", "lock", r.path]); // leave it as we found it
      refused.push({ path: r.path, reason: `git refused: ${rm.out}` });
    }
  }
  gitIn(repo, ["worktree", "prune"]);
  return { removed, refused };
}
