/**
 * Sessions work in their own worktree, never in the shared checkout
 * (docs/OPEN.md Q47), and a commit from the wrong tree is caught (Q18).
 *
 * On 2026-09-23 two sessions' commits made each other's trees lag, and a
 * worktree-isolated agent (FormSpec lane) found its cwd swapped to the SHARED
 * main checkout mid-task. It noticed; a less careful one would have committed
 * from there. Pure decisions live here so src/test/sessionWorktree.test.ts can
 * drive them on a real fixture repo; scripts/session-worktree.mjs does the I/O.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Where a git process is, from `git rev-parse --show-toplevel --absolute-git-dir
 * --git-common-dir` (all absolute). The PRIMARY checkout is the one whose git
 * dir IS the common dir; every `git worktree add` tree has its own git dir
 * under <common>/worktrees/<name>.
 */
export function describeTree({ toplevel, gitDir, commonDir }) {
  return { toplevel: resolve(toplevel), primary: resolve(gitDir) === resolve(commonDir) };
}

/**
 * Who is committing. A Claude Code session exports CLAUDE_CODE_SESSION_ID (and
 * CLAUDECODE=1) to every command it runs, git hooks included; the owner typing
 * `git commit` in a terminal has neither. A cloud session (CLAUDE_CODE_REMOTE=true)
 * runs in its own container with its own clone, so its "primary" checkout is
 * private to it and is not the shared tree this rule protects.
 */
export function describeSession(env) {
  const id = env.CLAUDE_CODE_SESSION_ID || (env.CLAUDECODE === "1" ? "unknown" : "");
  return { inSession: Boolean(id), id, remote: env.CLAUDE_CODE_REMOTE === "true" };
}

export const OVERRIDE = "LH_SHARED_CHECKOUT_OK";

/**
 * The pre-commit verdict.
 *  - refuse: a local Claude session committing from the SHARED primary checkout
 *    (Q47: it is read-only for sessions), unless LH_SHARED_CHECKOUT_OK=<reason>;
 *  - warn:   the session recorded a different start tree than this one (Q18).
 *    Only a warning: a worktree-isolated subagent shares its lead's session id
 *    and legitimately commits from its own linked worktree;
 *  - allow:  everything else (the owner's own terminal, a linked worktree, a
 *    cloud container's private clone).
 * `startTree` is the toplevel recorded at session start, or null.
 */
export function commitVerdict({ tree, session, startTree, env }) {
  if (!session.inSession) return { action: "allow", reason: "not a Claude session" };
  if (tree.primary && !session.remote) {
    const why = (env[OVERRIDE] || "").trim();
    if (why) return { action: "allow", reason: `shared checkout allowed by ${OVERRIDE}: ${why}`, logged: true };
    return {
      action: "refuse",
      reason:
        `Q47: this is the SHARED main checkout (${tree.toplevel}); sessions never commit here.\n` +
        (startTree && resolve(startTree) !== tree.toplevel
          ? `Q18: this session started in ${startTree}. Your cwd was moved; go back there and commit.\n`
          : `Work in your session worktree (printed at session start: ~/.lh-wt/session-<hash>), or \`git worktree add --detach ~/.lh-wt/<name> origin/main\`.\n`) +
        `Owner-approved exception only: ${OVERRIDE}="<reason>" git commit ... (the reason is logged).`,
    };
  }
  if (startTree && resolve(startTree) !== tree.toplevel) {
    return {
      action: "warn",
      reason: `Q18: this session started in ${startTree} but is committing from ${tree.toplevel}. Fine for a worktree-isolated subagent; otherwise stop and check your cwd.`,
    };
  }
  return { action: "allow", reason: tree.primary ? "cloud session's private clone" : "linked worktree" };
}

/** Session-start plan: where this session should work. */
export function startPlan({ tree, session, home }) {
  if (!session.inSession) return { action: "none", reason: "not a Claude session" };
  if (session.remote) return { action: "none", reason: "cloud container: its clone is private to this session" };
  if (!tree.primary) return { action: "none", reason: `already in a linked worktree (${tree.toplevel})` };
  return { action: "create", path: resolve(home, ".lh-wt", `session-${sessionTag(session.id)}`) };
}

/**
 * Stable 8-hex tag for a session's worktree name: a hash, not the raw id, so
 * the path the hook prints carries no environment value (CodeQL
 * js/clear-text-logging on PR #1823). Same session id -> same worktree on resume.
 */
export function sessionTag(sessionId) {
  return createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 8);
}

/** File name that records a session's start tree, under <common git dir>/lh-sessions/. */
export function recordName(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
}
