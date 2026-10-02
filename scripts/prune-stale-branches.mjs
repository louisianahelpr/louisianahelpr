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
 *   - main, or a land/* branch (land.sh's PR heads; auto-merge deletes them)
 *                                          -> KEEP (protected)
 *   - an open PR has it as head          -> KEEP (open PR)
 *   - tip committed less than MIN_AGE_HOURS ago
 *                                          -> KEEP (too new: someone may be mid-push)
 *   - `git cherry origin/main origin/<b>` prints no `+` line
 *                                          -> DELETE (every patch is on main)
 *   - otherwise                          -> UNLANDED (kept, reported)
 *
 * Usage:
 *   node scripts/prune-stale-branches.mjs            # dry run, prints the table
 *   node scripts/prune-stale-branches.mjs --apply    # deletes DELETE rows only
 *
 * STRANDED (2026-10-02): agents push branches but never land them; landing
 * waited on the lead running land.sh per branch, and 40+ commits (money fixes
 * among them) sat on origin with no PR while this job stayed green. A branch is
 * STRANDED when it is over STRANDED_AFTER_HOURS old, has no open PR, and holds
 * a commit whose patch (`git cherry`) AND subject are on neither main nor any
 * open PR head (subjects catch work a conflict-resolving rebase rewrote). Any
 * STRANDED branch makes this exit 1, so the workflow files a nightly-red issue.
 * land/* branches count too: a land PR closed unmerged strands its head.
 * Resolve one by landing it (bash scripts/land.sh) or deleting the branch.
 *
 * Fails closed: if the open-PR list or any cherry cannot be read, it exits
 * non-zero before deleting anything. Each delete is leased on the tip it
 * measured (--force-with-lease), so a branch pushed to since is left alone.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROTECTED = new Set(["main", "HEAD"]);
export const PROTECTED_PREFIXES = ["land/"];
export const MIN_AGE_HOURS = 24;
export const STRANDED_AFTER_HOURS = 1;

export function isProtected(name) {
  return PROTECTED.has(name) || PROTECTED_PREFIXES.some((p) => name.startsWith(p));
}

/** Number of commits on the branch whose patch is NOT on main. */
export function countUnlanded(cherryOutput) {
  return String(cherryOutput)
    .split("\n")
    .filter((line) => line.startsWith("+")).length;
}

/**
 * Pure decision for one branch.
 * @param {{ name: string, hasOpenPr: boolean, cherryOutput: string, ageHours: number }} b
 * @returns {{ name: string, action: "KEEP"|"DELETE"|"UNLANDED", reason: string }}
 */
export function decideBranch({ name, hasOpenPr, cherryOutput, ageHours }) {
  if (isProtected(name)) return { name, action: "KEEP", reason: "protected" };
  if (hasOpenPr) return { name, action: "KEEP", reason: "open PR" };
  if (!(ageHours >= MIN_AGE_HOURS)) {
    return { name, action: "KEEP", reason: `tip under ${MIN_AGE_HOURS}h old` };
  }
  const unlanded = countUnlanded(cherryOutput);
  if (unlanded === 0) return { name, action: "DELETE", reason: "all commits on main" };
  return { name, action: "UNLANDED", reason: `${unlanded} commit(s) not on main` };
}

/**
 * `git cherry -v` lines ("+ <sha> <subject>") whose work is on neither main
 * nor an open PR: patch not on main (the "+") and subject not in `covered`.
 * @param {string} cherryVerbose
 * @param {Set<string>} covered subjects on main or on an open PR head
 * @returns {{ sha: string, subject: string }[]}
 */
export function uncoveredCommits(cherryVerbose, covered) {
  return String(cherryVerbose)
    .split("\n")
    .filter((line) => line.startsWith("+ "))
    .map((line) => {
      const rest = line.slice(2);
      const sp = rest.indexOf(" ");
      return sp < 0 ? { sha: rest, subject: "" } : { sha: rest.slice(0, sp), subject: rest.slice(sp + 1) };
    })
    .filter((c) => !covered.has(c.subject));
}

/**
 * Pure: is this branch stranded work (pushed, unlanded, no PR, not new)?
 * @param {{ name: string, hasOpenPr: boolean, ageHours: number, uncovered: unknown[] }} b
 */
export function isStranded({ name, hasOpenPr, ageHours, uncovered }) {
  if (PROTECTED.has(name)) return false;
  if (hasOpenPr) return false;
  if (!(ageHours >= STRANDED_AFTER_HOURS)) return false;
  return uncovered.length > 0;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Remote branches with their tip sha and the tip's committer time (unix s). */
function listRemoteBranches() {
  return git([
    "for-each-ref",
    "--format=%(refname:strip=3) %(objectname) %(committerdate:unix)",
    "refs/remotes/origin",
  ])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, sha, ts] = line.split(" ");
      return { name, sha, ageHours: (Date.now() / 1000 - Number(ts)) / 3600 };
    })
    .filter((b) => b.name && b.name !== "HEAD");
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
  const branches = listRemoteBranches();
  const tipOf = new Map(branches.map((b) => [b.name, b.sha]));
  const rows = branches.map(({ name, ageHours }) =>
    decideBranch({
      name,
      ageHours,
      hasOpenPr: openHeads.has(name),
      cherryOutput:
        isProtected(name) || openHeads.has(name) ? "" : git(["cherry", "origin/main", `origin/${name}`]),
    }),
  );

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

  // Subjects already on main (recent history) or on any open PR's head.
  const covered = new Set(git(["log", "--format=%s", "-n", "5000", "origin/main"]).split("\n"));
  for (const head of openHeads) {
    if (!tipOf.has(head)) continue;
    for (const s of git(["log", "--format=%s", `origin/main..origin/${head}`]).split("\n")) covered.add(s);
  }
  const stranded = [];
  for (const { name, ageHours } of branches) {
    const hasOpenPr = openHeads.has(name);
    if (PROTECTED.has(name) || hasOpenPr || !(ageHours >= STRANDED_AFTER_HOURS)) continue;
    const uncovered = uncoveredCommits(git(["cherry", "-v", "origin/main", `origin/${name}`]), covered);
    if (isStranded({ name, hasOpenPr, ageHours, uncovered })) stranded.push({ name, ageHours, uncovered });
  }
  if (stranded.length) {
    console.log(`\nSTRANDED: ${stranded.length} branch(es) hold work on neither main nor an open PR (land it or delete it):`);
    for (const b of stranded) {
      console.log(`  ${b.name} (${Math.round(b.ageHours)}h old, ${b.uncovered.length} commit(s))`);
      for (const c of b.uncovered) console.log(`    ${c.sha.slice(0, 9)} ${c.subject}`);
    }
  } else {
    console.log("\nSTRANDED: none.");
  }

  let failed = 0;
  if (apply) {
    for (const r of rows.filter((x) => x.action === "DELETE")) {
      try {
        // Leased on the tip we measured: a push since then makes this fail, not delete.
        git(["push", `--force-with-lease=refs/heads/${r.name}:${tipOf.get(r.name)}`, "origin", "--delete", r.name]);
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
    let md = `## Branch prune\n\n${n("DELETE")} deleted-on-main, ${unl.length} unlanded, ${n("KEEP")} kept (protected, open PR or under 24h)${failed ? `, ${failed} delete failures` : ""}.\n\n`;
    if (unl.length) {
      md += "### UNLANDED (kept; a human decides)\n\n| branch | commits not on main |\n|---|---|\n";
      for (const r of unl) md += `| \`${r.name}\` | ${r.reason} |\n`;
    }
    if (stranded.length) {
      md += `\n### STRANDED (red): work on neither main nor an open PR\n\nLand each with \`bash scripts/land.sh\` or delete the branch.\n\n| branch | age | commits |\n|---|---|---|\n`;
      for (const b of stranded) md += `| \`${b.name}\` | ${Math.round(b.ageHours)}h | ${b.uncovered.map((c) => c.subject).join("<br>")} |\n`;
    }
    appendFileSync(summary, md);
  }
  if (failed || stranded.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
