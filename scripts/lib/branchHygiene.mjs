/**
 * Which local branches scripts/prune-git-hygiene.mjs may delete.
 *
 * WHY. land.sh rebases every PR onto main before it merges, so a landed
 * branch's work sits on main under NEW commit SHAs. The old rule only looked at
 * `git branch --merged origin/main` (an SHA-ancestry test), so every
 * rebase-landed branch read as "unlanded" and was kept forever: on 2026-10-02 a
 * run skipped 24 branches and deleted none.
 *
 * A branch is LANDED when either
 *   - its tip is an ancestor of origin/main (the old --merged rule), or
 *   - `git cherry origin/main <branch>` prints no `+` line, i.e. every commit on
 *     it is patch-equivalent to a commit already on origin/main.
 * It is deleted only if it is landed, is not main/master, is not checked out in
 * any worktree, and its reflog was last touched more than MIN_AGE ago. An
 * ancestor branch goes through `git branch -d` (as before); a patch-landed one
 * through `git update-ref -d refs/heads/<b> <sha>`, which refuses if the branch
 * moved after it was checked. Never `branch -D`, never --force.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";

function gitIn(cwd, argv, timeout = 30_000) {
  try {
    const out = execFileSync("git", argv, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
    return { ok: true, code: 0, out };
  } catch (e) {
    return { ok: false, code: e.status ?? null, out: String(e.stderr || e.message).trim().split("\n")[0] };
  }
}

/**
 * Decide one branch from gathered facts.
 * f: { name, merged: boolean, unlanded: number | null, unlandedSubjects: string[],
 *      checkedOut: boolean, ageMs: number | null }
 * @returns {{action: "delete" | "skip", how?: "merged" | "patch", reason?: string}}
 */
export function classifyBranch(f, minAgeMs) {
  if (f.name === "main" || f.name === "master") return { action: "skip", reason: "the main branch" };
  if (f.unlanded === null && !f.merged) return { action: "skip", reason: "git cherry failed" };
  const landed = f.merged || f.unlanded === 0;
  if (!landed) {
    const subj = f.unlandedSubjects.slice(0, 3).join("; ");
    return { action: "skip", reason: `${f.unlanded} patch(es) not on origin/main${subj ? `: ${subj}` : ""}` };
  }
  if (f.checkedOut) return { action: "skip", reason: "checked out in a worktree" };
  if (f.ageMs !== null && f.ageMs < minAgeMs) {
    return { action: "skip", reason: `created/moved ${Math.round(f.ageMs / 60_000)}m ago (< ${minAgeMs / 60_000}m)` };
  }
  return { action: "delete", how: f.merged ? "merged" : "patch" };
}

/**
 * Plan the branch cleanup for the repo at `repo`.
 * @param {string} repo
 * @param {object} o
 * @param {Set<string>} o.checkedOut branches checked out in any worktree
 * @param {string} [o.base]
 * @param {number} [o.minAgeMs]
 * @param {number} [o.nowMs]
 * @param {() => boolean} [o.outOfTime]
 */
export function planBranchCleanup(repo, o) {
  const base = o.base ?? "origin/main";
  const minAgeMs = o.minAgeMs ?? 120 * 60_000;
  const nowMs = o.nowMs ?? Date.now();
  const common = gitIn(repo, ["rev-parse", "--git-common-dir"]);
  if (!common.ok) throw new Error(`not a git repo: ${common.out}`);
  const commonDir = resolve(repo, common.out);
  const refs = gitIn(repo, ["for-each-ref", "refs/heads", "--format=%(refname:short)%09%(objectname)"]);
  if (!refs.ok) throw new Error(`git for-each-ref failed: ${refs.out}`);

  const plan = { delete: [], skip: [] };
  for (const line of refs.out.split("\n").filter(Boolean)) {
    const [name, sha] = line.split("\t");
    if (name === "main" || name === "master") continue;
    if (o.outOfTime?.()) {
      plan.skip.push({ branch: name, sha, reason: "time box reached" });
      continue;
    }
    // exit 0 = ancestor, 1 = not; anything else is an error (treated as not merged).
    const merged = gitIn(repo, ["merge-base", "--is-ancestor", sha, base]).code === 0;
    let unlanded = 0;
    let unlandedSubjects = [];
    if (!merged) {
      const ch = gitIn(repo, ["cherry", "-v", base, sha]);
      if (!ch.ok) unlanded = null;
      else {
        const plus = ch.out.split("\n").filter((l) => l.startsWith("+"));
        unlanded = plus.length;
        unlandedSubjects = plus.map((l) => l.replace(/^\+ [0-9a-f]+ /, ""));
      }
    }
    let ageMs = null;
    try {
      ageMs = nowMs - statSync(join(commonDir, "logs", "refs", "heads", ...name.split("/"))).mtimeMs;
    } catch {
      /* no reflog: age unknown, as before */
    }
    const f = { name, merged, unlanded, unlandedSubjects, checkedOut: o.checkedOut.has(name), ageMs };
    const d = classifyBranch(f, minAgeMs);
    if (d.action === "delete") plan.delete.push({ branch: name, sha, how: d.how });
    else plan.skip.push({ branch: name, sha, reason: d.reason, unlanded, unlandedSubjects });
  }
  return plan;
}

/** Carry out plan.delete. Ancestors: `branch -d`; patch-landed: compare-and-delete the ref. */
export function applyBranchPlan(repo, plan) {
  const deleted = [];
  const refused = [];
  for (const d of plan.delete) {
    const r =
      d.how === "merged"
        ? gitIn(repo, ["branch", "-d", d.branch]) // never -D
        : gitIn(repo, ["update-ref", "-d", `refs/heads/${d.branch}`, d.sha]); // fails if it moved
    if (r.ok) deleted.push(d.branch);
    else refused.push({ branch: d.branch, reason: `git refused: ${r.out}` });
  }
  return { deleted, refused };
}
