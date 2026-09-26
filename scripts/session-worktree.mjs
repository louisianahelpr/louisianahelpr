#!/usr/bin/env node
/**
 * Per-session worktrees (docs/OPEN.md Q47) and the wrong-tree commit check (Q18).
 * Decisions: scripts/lib/sessionWorktree.mjs. Guard: src/test/sessionWorktree.test.ts.
 *
 *   node scripts/session-worktree.mjs start
 *       SessionStart hook. In a LOCAL Claude session that opened in the shared
 *       main checkout: creates (or reuses) ~/.lh-wt/session-<id8> detached at
 *       origin/main, symlinks node_modules into it, records it as this session's
 *       tree and prints a banner telling the session to work there. Otherwise it
 *       records the current tree. Local git only (no fetch); never fails.
 *
 *   node scripts/session-worktree.mjs check-commit
 *       .husky/pre-commit. Refuses a Claude session's commit from the shared
 *       checkout (override: LH_SHARED_CHECKOUT_OK="<reason>", logged to
 *       ~/.lh-hygiene/shared-checkout-commits.log); warns when the session is
 *       committing from a different tree than the one it recorded.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { commitVerdict, describeSession, describeTree, recordName, startPlan } from "./lib/sessionWorktree.mjs";

const git = (args, cwd = process.cwd()) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function whereAmI(cwd = process.cwd()) {
  const [toplevel, gitDir, commonDir] = git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], cwd).split("\n");
  return { tree: describeTree({ toplevel, gitDir, commonDir }), commonDir };
}

const recordPath = (commonDir, id) => join(commonDir, "lh-sessions", recordName(id));

function start() {
  const session = describeSession(process.env);
  if (!session.inSession) return;
  const { tree, commonDir } = whereAmI(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const plan = startPlan({ tree, session, home: homedir() });
  let home = tree.toplevel;
  if (plan.action === "create") {
    if (!existsSync(plan.path)) {
      mkdirSync(join(plan.path, ".."), { recursive: true });
      let base = "origin/main";
      try { git(["rev-parse", "--verify", "-q", base], tree.toplevel); } catch { base = "HEAD"; }
      git(["worktree", "add", "--detach", plan.path, base], tree.toplevel);
      const nm = join(tree.toplevel, "node_modules");
      if (existsSync(nm) && !existsSync(join(plan.path, "node_modules"))) symlinkSync(nm, join(plan.path, "node_modules"));
    }
    home = plan.path;
    console.log([
      "",
      "=== THIS SESSION'S WORKTREE (docs/OPEN.md Q47) ===",
      `You opened in the SHARED main checkout (${tree.toplevel}). It is read-only for sessions:`,
      `the pre-commit hook refuses commits there. Work in your own worktree:`,
      `    cd ${plan.path}`,
      "(detached at origin/main when created; node_modules is symlinked from the main checkout).",
      "",
    ].join("\n"));
  }
  mkdirSync(join(commonDir, "lh-sessions"), { recursive: true });
  writeFileSync(recordPath(commonDir, session.id), home + "\n");
}

function checkCommit() {
  const session = describeSession(process.env);
  const { tree, commonDir } = whereAmI();
  let startTree = null;
  if (session.inSession) {
    try { startTree = readFileSync(recordPath(commonDir, session.id), "utf8").trim() || null; } catch { /* no record: session predates the hook */ }
  }
  const v = commitVerdict({ tree, session, startTree, env: process.env });
  if (v.action === "refuse") {
    console.error(`\n✗ commit refused.\n${v.reason}\n`);
    process.exit(1);
  }
  if (v.action === "warn") console.error(`⚠ ${v.reason}`);
  if (v.logged) {
    try {
      const dir = join(homedir(), ".lh-hygiene");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "shared-checkout-commits.log"), `${new Date().toISOString()}\t${session.id}\t${tree.toplevel}\t${v.reason}\n`);
    } catch { /* the log is a courtesy; the override itself was explicit */ }
  }
}

const cmd = process.argv[2];
try {
  if (cmd === "start") start();
  else if (cmd === "check-commit") checkCommit();
  else { console.error("usage: session-worktree.mjs start|check-commit"); process.exit(2); }
} catch (e) {
  // start must never break a session; check-commit fails OPEN only on a git
  // error (e.g. not a repo), which git itself would refuse anyway.
  console.error(`session-worktree ${cmd}: ${e instanceof Error ? e.message : e}`);
}
