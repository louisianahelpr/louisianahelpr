#!/usr/bin/env node
/**
 * Remove local git worktrees and branches that provably hold no work.
 *
 *   npm run hygiene                 # dry run: prints what it WOULD do
 *   npm run hygiene -- --apply      # does it
 *   node scripts/prune-git-hygiene.mjs --auto   # SessionStart: --apply, rate-limited,
 *                                                # time-boxed, logged under $HOME
 *
 * WHY. On 2026-09-22 the repo had ~39 worktrees and ~189 local branches; 22 of the
 * worktrees and ~166 of the branches were already fully in origin/main. Agents make
 * one per lane and nothing removed them, so a session kept cleaning them by hand.
 *
 * A LINKED worktree is removed only if ALL of these hold (any miss = skip + reason):
 *   - it is not the MAIN worktree (first entry of `git worktree list --porcelain`,
 *     and also not the parent of the common git dir). A past bulk-remove loop wiped
 *     the main repo; this script can never pass the main path to `worktree remove`;
 *   - it is not locked — EXCEPT a locked worktree under <main>/.claude/worktrees/
 *     (a finished worktree-isolated agent leaves one behind, Q77), which is
 *     unlocked first when every other condition holds, and REPORTED (never
 *     removed) when it holds unmerged commits or uncommitted work;
 *   - `git status --porcelain` is empty (tracked AND untracked);
 *   - `git rev-list --count origin/main..HEAD` is 0, or `git cherry` shows every
 *     commit already in origin/main by patch-id (after `git fetch origin`);
 *   - for a locked agent worktree: the pid in its lock reason, if any, is not running;
 *   - no process has its cwd inside it (`lsof -a -d cwd -Fn`, prefix-matched);
 *   - it was last touched more than 2h ago (so an agent that just made it is not raced).
 * Removal is `git worktree remove <path>` WITHOUT --force; if git refuses, skip.
 * The worktree rule lives in scripts/lib/worktreeHygiene.mjs (tested on a fixture
 * repo by src/test/pruneAgentWorktrees.test.ts).
 *
 * A local BRANCH is deleted only if it is in `git branch --merged origin/main`, is not
 * main, is not checked out in ANY worktree, was created/moved more than 2h ago, and
 * `git branch -d` (never -D) accepts it.
 *
 * Never touches remote branches, never stashes, never resets, never --force.
 */

import { execFileSync } from "node:child_process";
import {
  statSync, mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync, realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { staleUntracked } from "./lib/staleUntracked.mjs";
import { planWorktreeCleanup, applyWorktreePlan, parseWorktrees } from "./lib/worktreeHygiene.mjs";

const args = process.argv.slice(2);
const AUTO = args.includes("--auto");
const APPLY = AUTO || args.includes("--apply");
const NO_FETCH = args.includes("--no-fetch");
const MIN_AGE_MS = Number(process.env.LH_HYGIENE_MIN_AGE_MIN ?? 120) * 60_000;
const RATE_LIMIT_MS = 6 * 3600_000;
const DEADLINE = Date.now() + (AUTO ? 5 : 30) * 60_000;
const BASE = "origin/main";

const STATE_DIR = process.env.LH_HYGIENE_DIR ?? join(homedir(), ".lh-hygiene");
const LOG = join(STATE_DIR, "hygiene.log");
const STAMP = join(STATE_DIR, "last-run");
const LOCK = join(STATE_DIR, "lock");

const out = [];
const say = (s = "") => {
  out.push(s);
  if (!AUTO) console.log(s);
};

function git(argv, opts = {}) {
  return execFileSync("git", argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout ?? 30_000,
    cwd: opts.cwd,
    // GIT_OPTIONAL_LOCKS=0: `git status` must not refresh the index, or it would
    // bump the very mtime the 2h age check reads.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  }).trim();
}
const tryGit = (argv, opts) => {
  try {
    return { ok: true, out: git(argv, opts) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim().split("\n")[0] };
  }
};
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const outOfTime = () => Date.now() > DEADLINE;

/* ── --auto: rate limit + single-flight lock ─────────────────────────────── */
let lockHeld = false;
if (AUTO) {
  mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (Date.now() - statSync(STAMP).mtimeMs < RATE_LIMIT_MS) process.exit(0);
  } catch {
    /* no stamp yet: first run */
  }
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > 3600_000) unlinkSync(LOCK); // stale lock
  } catch {
    /* no lock */
  }
  try {
    closeSync(openSync(LOCK, "wx"));
    lockHeld = true;
  } catch {
    process.exit(0); // another session is already running it
  }
  writeFileSync(STAMP, new Date().toISOString() + "\n");
}

function finish(code = 0) {
  if (AUTO) {
    try {
      appendFileSync(LOG, `\n== ${new Date().toISOString()} (cwd ${process.cwd()})\n${out.join("\n")}\n`);
    } catch {
      /* logging must never fail the run */
    }
    if (lockHeld) {
      try {
        unlinkSync(LOCK);
      } catch {
        /* already gone */
      }
    }
  }
  process.exit(AUTO ? 0 : code);
}

try {
  main();
  finish(0);
} catch (e) {
  say(`ERROR: ${e.message}`);
  finish(1);
}

function main() {
  const commonDir = real(resolve(git(["rev-parse", "--git-common-dir"])));
  say(`${APPLY ? "APPLY" : "DRY RUN (pass --apply to act)"} — repo ${dirname(commonDir)}`);

  if (!NO_FETCH) {
    const f = tryGit(["fetch", "origin", "--quiet"], { timeout: 90_000 });
    if (!f.ok) say(`warning: git fetch origin failed (${f.out}); using the local ${BASE}`);
  }
  if (!tryGit(["rev-parse", "--verify", "-q", BASE]).ok) {
    say(`no ${BASE} ref — nothing is provably merged, doing nothing.`);
    return;
  }

  /* ── worktrees (rule in scripts/lib/worktreeHygiene.mjs) ──────────────── */
  let cwds = [];
  try {
    cwds = execFileSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  } catch (e) {
    // lsof exits 1 when some processes are unreadable but still prints the rest.
    if (e.stdout) cwds = String(e.stdout).split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
    else {
      say("warning: lsof unavailable — cannot prove no process is inside a worktree, so none will be removed");
      cwds = null;
    }
  }

  const plan = planWorktreeCleanup(process.cwd(), { cwds, minAgeMs: MIN_AGE_MS, base: BASE, outOfTime });
  const entries = plan.entries;
  const skipped = plan.skip.map((s) => [s.path, s.reason]);
  let removed = plan.remove.map((r) => r.path);
  if (APPLY) {
    const res = applyWorktreePlan(process.cwd(), plan);
    removed = res.removed;
    for (const r of res.refused) skipped.push([r.path, r.reason]);
  }
  const unlocked = plan.remove.filter((r) => r.unlock && removed.includes(r.path)).length;

  /* ── branches ──────────────────────────────────────────────────────────── */
  const afterEntries = APPLY
    ? parseWorktrees(git(["worktree", "list", "--porcelain"]))
    : entries.filter((e) => !removed.includes(e.path));
  const checkedOut = new Set(afterEntries.map((e) => e.branch).filter(Boolean));
  const merged = git(["branch", "--merged", BASE, "--format=%(refname:short)"])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const deleted = [];
  const branchSkipped = [];
  for (const b of merged) {
    if (b === "main" || b === "master") continue;
    if (checkedOut.has(b)) {
      branchSkipped.push([b, "checked out in a worktree"]);
      continue;
    }
    if (outOfTime()) {
      branchSkipped.push([b, "time box reached"]);
      continue;
    }
    const age = branchAgeMs(commonDir, b);
    if (age !== null && age < MIN_AGE_MS) {
      branchSkipped.push([b, `created/moved ${Math.round(age / 60_000)}m ago (< ${MIN_AGE_MS / 60_000}m)`]);
      continue;
    }
    if (!APPLY) {
      deleted.push(b);
      continue;
    }
    const r = tryGit(["branch", "-d", b]); // never -D
    if (r.ok) deleted.push(b);
    else branchSkipped.push([b, `git refused: ${r.out}`]);
  }

  /* ── summary ───────────────────────────────────────────────────────────── */
  /* ── untracked docs (Q78): report only, never delete ─────────────────── */
  try {
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    const untracked = git(["-C", top, "ls-files", "--others", "--exclude-standard", "docs/"])
      .split("\n").filter(Boolean)
      .map((p) => ({ path: p, mtimeMs: statSync(join(top, p)).mtimeMs }));
    const stale = staleUntracked(untracked, Date.now(), 2);
    if (stale.length) {
      say(`UNTRACKED in docs/ for over 2 days (${stale.length}) — commit as a dated record or delete (Q78):`);
      for (const p of stale) say(`  - ${p}`);
    }
  } catch (e) {
    say(`untracked-docs check could not run: ${e.message}`);
  }

  const verb = APPLY ? "" : "would ";
  say("");
  if (plan.report.length) {
    say(`FINISHED-AGENT worktrees holding UNMERGED work (${plan.report.length}) — NOT removed; land or discard by hand (Q77):`);
    for (const r of plan.report) say(`  - ${r.path}${r.branch ? ` [${r.branch}]` : ""} — ${r.reason}`);
  }
  say(`${verb}remove ${removed.length} worktree(s)${unlocked ? ` (${unlocked} locked agent worktree(s) unlocked first)` : ""}:`);
  for (const p of removed) say(`  - ${p}`);
  say(`${verb}delete ${deleted.length} branch(es)${deleted.length ? ":" : ""}`);
  for (const b of deleted) say(`  - ${b}`);
  const allSkipped = [...skipped.map(([p, r]) => ["worktree", p, r]), ...branchSkipped.map(([b, r]) => ["branch", b, r])];
  say(`skipped ${allSkipped.length}:`);
  for (const [kind, what, why] of allSkipped) say(`  - ${kind} ${what} — ${why}`);
  say("");
  say(
    `SUMMARY: ${APPLY ? "removed" : "would remove"} ${removed.length} worktrees, ` +
      `${APPLY ? "deleted" : "would delete"} ${deleted.length} branches, ` +
      `skipped ${allSkipped.length} (${skipped.length} worktrees, ${branchSkipped.length} branches), ` +
      `reported ${plan.report.length} unmerged agent worktrees`,
  );
}

/** Age of the branch's reflog (last creation/move); null if there is no reflog. */
function branchAgeMs(commonDir, b) {
  try {
    return Date.now() - statSync(join(commonDir, "logs", "refs", "heads", ...b.split("/"))).mtimeMs;
  } catch {
    return null;
  }
}
