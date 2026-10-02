#!/usr/bin/env node
/**
 * Prune remote branches whose every commit is already on main.
 *
 * WHY: delete_branch_on_merge is ON, but it only fires when a PR MERGES. The
 * leftovers come from PRs closed unmerged (superseded by a batch PR that
 * carried the same commits) and from stray pushes with no PR at all. This
 * extends the same cleanup to branches whose work is already on main by
 * patch identity (`git cherry`), so it survives rebases and squash-free
 * batch landings.
 *
 * Decision, per remote branch other than main:
 *   - an open PR has it as head          -> KEEP (open PR)
 *   - a merge commit not on main         -> UNLANDED (`git cherry` skips
 *                                             merges, so a merge carrying a
 *                                             conflict resolution or an edit
 *                                             would otherwise read as landed)
 *   - `git cherry origin/main origin/<b>` prints no `+` line
 *                                          -> DELETE (every patch is on main)
 *   - otherwise                          -> UNLANDED (kept, reported)
 *
 * The delete is leased to the SHA that was checked
 * (`--force-with-lease=refs/heads/<b>:<sha>`), so a branch that gains a commit
 * between the check and the delete is refused by the remote, not deleted.
 *
 * Usage:
 *   node scripts/prune-stale-branches.mjs            # dry run, prints the table
 *   node scripts/prune-stale-branches.mjs --apply    # deletes DELETE rows only
 *
 * Fails closed: if the open-PR list or any cherry cannot be read, it exits
 * non-zero before deleting anything.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROTECTED = new Set(["main", "HEAD"]);

/** Number of commits on the branch whose patch is NOT on main. */
export function countUnlanded(cherryOutput) {
  return String(cherryOutput)
    .split("\n")
    .filter((line) => line.startsWith("+")).length;
}

/**
 * Pure decision for one branch.
 * @param {{ name: string, hasOpenPr: boolean, cherryOutput: string, mergesAhead: number }} b
 * @returns {{ name: string, action: "KEEP"|"DELETE"|"UNLANDED", reason: string }}
 */
export function decideBranch({ name, hasOpenPr, cherryOutput, mergesAhead }) {
  if (PROTECTED.has(name)) return { name, action: "KEEP", reason: "protected" };
  if (hasOpenPr) return { name, action: "KEEP", reason: "open PR" };
  // Fail closed: an unread or non-zero merge count is never a delete.
  if (!Number.isInteger(mergesAhead) || mergesAhead !== 0) {
    return { name, action: "UNLANDED", reason: `${mergesAhead} merge commit(s) not on main` };
  }
  const unlanded = countUnlanded(cherryOutput);
  if (unlanded === 0) return { name, action: "DELETE", reason: "all commits on main" };
  return { name, action: "UNLANDED", reason: `${unlanded} commit(s) not on main` };
}

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd });
}

/** Reads what decideBranch needs about one branch, pinned to its SHA. Throws on any git error. */
export function inspectBranch(name, cwd) {
  const sha = git(["rev-parse", "--verify", `origin/${name}^{commit}`], cwd).trim();
  const merges = git(["rev-list", "--count", "--merges", `origin/main..${sha}`], cwd).trim();
  return {
    sha,
    cherryOutput: git(["cherry", "origin/main", sha], cwd),
    // Strict parse: anything but digits is NaN, which decideBranch keeps.
    mergesAhead: /^\d+$/.test(merges) ? Number(merges) : Number.NaN,
  };
}

/** Delete one remote branch, leased to the SHA that was checked. Throws when the remote refuses. */
export function deleteBranch(name, sha, cwd) {
  git(["push", `--force-with-lease=refs/heads/${name}:${sha}`, "origin", "--delete", name], cwd);
}

function listRemoteBranches() {
  return git(["for-each-ref", "--format=%(refname:strip=3)", "refs/remotes/origin"])
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !PROTECTED.has(s));
}

function listOpenPrHeads() {
  const out = execFileSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "1000", "--json", "headRefName"],
    { encoding: "utf8" },
  );
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) throw new Error("gh pr list did not return an array");
  return new Set(rows.map((r) => r.headRefName));
}

function main() {
  const apply = process.argv.includes("--apply");
  const openHeads = listOpenPrHeads();
  const shas = new Map();
  const rows = listRemoteBranches().map((name) => {
    if (openHeads.has(name)) return decideBranch({ name, hasOpenPr: true, cherryOutput: "", mergesAhead: 0 });
    const { sha, cherryOutput, mergesAhead } = inspectBranch(name);
    shas.set(name, sha);
    return decideBranch({ name, hasOpenPr: false, cherryOutput, mergesAhead });
  });

  const order = { DELETE: 0, UNLANDED: 1, KEEP: 2 };
  rows.sort((a, b) => order[a.action] - order[b.action] || a.name.localeCompare(b.name));
  const w = Math.max(6, ...rows.map((r) => r.name.length));
  console.log(`${"ACTION".padEnd(9)} ${"BRANCH".padEnd(w)} REASON`);
  for (const r of rows) console.log(`${r.action.padEnd(9)} ${r.name.padEnd(w)} ${r.reason}`);
  const n = (a) => rows.filter((r) => r.action === a).length;
  console.log(
    `\n${rows.length} branches: ${n("DELETE")} DELETE, ${n("UNLANDED")} UNLANDED, ${n("KEEP")} KEEP` +
      (apply ? "" : "  (dry run; pass --apply to delete the DELETE rows)"),
  );

  let failed = 0;
  if (apply) {
    for (const r of rows.filter((x) => x.action === "DELETE")) {
      try {
        deleteBranch(r.name, shas.get(r.name));
        console.log(`deleted ${r.name}`);
      } catch (e) {
        failed++;
        console.error(`FAILED to delete ${r.name}: ${e.message}`);
      }
    }
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const unl = rows.filter((r) => r.action === "UNLANDED");
    let md = `## Branch prune\n\n${n("DELETE")} deleted-on-main, ${unl.length} unlanded, ${n("KEEP")} kept (open PR)${failed ? `, ${failed} delete failures` : ""}.\n\n`;
    if (unl.length) {
      md += "### UNLANDED (kept; a human decides)\n\n| branch | commits not on main |\n|---|---|\n";
      for (const r of unl) md += `| \`${r.name}\` | ${r.reason} |\n`;
    }
    appendFileSync(summary, md);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
