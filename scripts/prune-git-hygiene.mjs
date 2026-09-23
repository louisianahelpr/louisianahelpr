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
 *   - it is not locked;
 *   - `git status --porcelain` is empty (tracked AND untracked);
 *   - `git rev-list --count origin/main..HEAD` is 0 (after `git fetch origin`);
 *   - no process has its cwd inside it (`lsof -a -d cwd -Fn`, prefix-matched);
 *   - it was last touched more than 2h ago (so an agent that just made it is not raced).
 * Removal is `git worktree remove <path>` WITHOUT --force; if git refuses, skip.
 *
 * A local BRANCH is deleted only if it is in `git branch --merged origin/main`, is not
 * main, is not checked out in ANY worktree, was created/moved more than 2h ago, and
 * `git branch -d` (never -D) accepts it.
 *
 * Never touches remote branches, never stashes, never resets, never --force.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync, statSync, mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { staleUntracked } from "./lib/staleUntracked.mjs";

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

  /* ── worktrees ─────────────────────────────────────────────────────────── */
  const entries = parseWorktrees(git(["worktree", "list", "--porcelain"]));
  const mainPath = entries[0]?.path;
  const protectedPaths = new Set([mainPath, dirname(commonDir)].filter(Boolean).map(real));

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
  const cwdInside = (p) => cwds === null || cwds.some((c) => c === p || c.startsWith(p + sep));

  const removed = [];
  const skipped = [];
  for (const wt of entries) {
    const p = real(wt.path);
    if (protectedPaths.has(p) || wt === entries[0]) continue; // main: never a candidate, not even reported
    if (outOfTime()) {
      skipped.push([wt.path, "time box reached"]);
      continue;
    }
    const reason = worktreeSkipReason(wt, p, cwdInside);
    if (reason) {
      skipped.push([wt.path, reason]);
      continue;
    }
    if (!APPLY) {
      removed.push(wt.path);
      continue;
    }
    const r = tryGit(["worktree", "remove", wt.path]); // NO --force, ever
    if (r.ok) removed.push(wt.path);
    else skipped.push([wt.path, `git refused: ${r.out}`]);
  }
  if (APPLY) tryGit(["worktree", "prune"]);

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
  say(`${verb}remove ${removed.length} worktree(s):`);
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
      `skipped ${allSkipped.length} (${skipped.length} worktrees, ${branchSkipped.length} branches)`,
  );
}

function parseWorktrees(porcelain) {
  const list = [];
  let cur = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), locked: false, prunable: false, branch: null, bare: false };
      list.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "locked" || line.startsWith("locked ")) cur.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
    else if (line === "bare") cur.bare = true;
  }
  return list;
}

function worktreeSkipReason(wt, p, cwdInside) {
  if (wt.bare) return "bare";
  if (wt.locked) return "locked";
  if (wt.prunable || !existsSync(wt.path)) return "directory missing (left to `git worktree prune`)";
  const age = worktreeAgeMs(wt.path); // read BEFORE any git command touches the tree
  const st = tryGit(["status", "--porcelain", "--untracked-files=all"], { cwd: wt.path });
  if (!st.ok) return `git status failed: ${st.out}`;
  if (st.out) return `uncommitted/untracked changes (${st.out.split("\n").length} path(s))`;
  const ahead = tryGit(["rev-list", "--count", `${BASE}..HEAD`], { cwd: wt.path });
  if (!ahead.ok) return `rev-list failed: ${ahead.out}`;
  if (ahead.out !== "0") return `${ahead.out} commit(s) not in ${BASE}`;
  if (cwdInside(p)) return "a running process has its cwd inside it";
  if (age === null) return "cannot read its age";
  if (age < MIN_AGE_MS) return `touched ${Math.round(age / 60_000)}m ago (< ${MIN_AGE_MS / 60_000}m)`;
  return null;
}

/** Youngest of: the worktree's `.git` file, its admin dir's HEAD and index. */
function worktreeAgeMs(path) {
  const stamps = [];
  const add = (f) => {
    try {
      stamps.push(statSync(f).mtimeMs);
    } catch {
      /* missing */
    }
  };
  add(join(path, ".git"));
  const gd = tryGit(["rev-parse", "--absolute-git-dir"], { cwd: path });
  if (gd.ok) {
    add(join(gd.out, "HEAD"));
    add(join(gd.out, "index"));
  }
  return stamps.length ? Date.now() - Math.max(...stamps) : null;
}

/** Age of the branch's reflog (last creation/move); null if there is no reflog. */
function branchAgeMs(commonDir, b) {
  try {
    return Date.now() - statSync(join(commonDir, "logs", "refs", "heads", ...b.split("/"))).mtimeMs;
  } catch {
    return null;
  }
}
