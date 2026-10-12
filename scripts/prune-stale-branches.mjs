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
 * open PR head (subjects catch work a conflict-resolving rebase rewrote), AND
 * whose CONTENT is not on main (scripts/lib/strandedContent.mjs; findStranded).
 * Identity alone re-opened auto-land PRs for a branch whose work had merged
 * (fix/no-false-signout: #2696, #2707, #2712) because a regenerated-inventory
 * commit and a superseded floor bump never match by patch. Any
 * STRANDED branch makes this exit 1, so the workflow files a nightly-red issue.
 * land/* branches count too: a land PR closed unmerged strands its head.
 * Resolve one by landing it (bash scripts/land.sh) or deleting the branch.
 *
 * AUTO-LAND (2026-10-02, owner: "fix this for good"): reporting alone left the
 * stranded work sitting for days. With --apply, every STRANDED branch now gets
 * a PR titled AUTO_LAND_PREFIX + branch, with rebase auto-merge on, so the
 * required checks decide and it lands with nobody in the loop. An auto-land
 * PR still open after AUTO_LAND_STUCK_HOURS (conflict or red check) makes
 * this exit 1, so a stalled one cannot hide behind "it has a PR".
 *
 * Fails closed: if the open-PR list or any cherry cannot be read, it exits
 * non-zero before deleting anything. Each delete is leased on the tip it
 * measured (--force-with-lease), so a branch pushed to since is left alone.
 */
import { execFileSync } from "node:child_process";
import { buildMainIndex, unlandedContent, gitRunner, buildRefsContentIndex, contentCoveredBy } from "./lib/strandedContent.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROTECTED = new Set(["main", "HEAD"]);
export const PROTECTED_PREFIXES = ["land/"];
export const MIN_AGE_HOURS = 24;
export const STRANDED_AFTER_HOURS = 1;
export const AUTO_LAND_PREFIX = "auto-land: ";
export const AUTO_LAND_STUCK_HOURS = 6;

/**
 * DUPLICATE FLOOD (2026-10-12: 144 open PRs, the same change in 2-4 of them).
 * This job runs on every push to main, and it opened an auto-land PR for:
 *   - claim/* branches, which only mark a lane's claim on a queue item
 *     (#2814 claim/Q1357, #2815 claim/Q1500, #2848, #2849), never work to land;
 *   - branches whose content another open PR already carries (a land-queue
 *     fix-land/* rebuild of a branch that had its own PR: #2818 beside #2771).
 * Neither gets one now, and a run opens at most MAX_AUTO_LAND_PER_RUN, and
 * none while MAX_OPEN_AUTO_LAND auto-land PRs are already open. The rest wait
 * for a later run (the stranded job still reports them).
 */
export const NEVER_AUTO_LAND_PREFIXES = ["claim/"];
export const MAX_AUTO_LAND_PER_RUN = 3;
export const MAX_OPEN_AUTO_LAND = 6;

/** How many auto-land PRs this run may open, given the open PR list. */
export function autoLandBudget(openPrs) {
  const open = openPrs.filter((p) => String(p.title).startsWith(AUTO_LAND_PREFIX)).length;
  return Math.max(0, Math.min(MAX_AUTO_LAND_PER_RUN, MAX_OPEN_AUTO_LAND - open));
}

export function autoLandTitle(name) {
  return `${AUTO_LAND_PREFIX}${name}`;
}

/**
 * Pure: auto-land PRs open long enough that they must be stuck.
 * @param {{ title: string, createdAt: string, headRefName: string }[]} prs
 * @param {number} nowMs
 */
export function stuckAutoLandPrs(prs, nowMs) {
  return prs.filter(
    (p) =>
      String(p.title).startsWith(AUTO_LAND_PREFIX) &&
      (nowMs - Date.parse(p.createdAt)) / 3_600_000 >= AUTO_LAND_STUCK_HOURS,
  );
}

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
export function decideBranch({ name, hasOpenPr, cherryOutput, ageHours, contentStranded = false }) {
  if (isProtected(name)) return { name, action: "KEEP", reason: "protected" };
  if (hasOpenPr) return { name, action: "KEEP", reason: "open PR" };
  if (!(ageHours >= MIN_AGE_HOURS)) {
    return { name, action: "KEEP", reason: `tip under ${MIN_AGE_HOURS}h old` };
  }
  const unlanded = countUnlanded(cherryOutput);
  // `git cherry` skips merge commits and only compares whole patches: a
  // conflict resolution inside a merge, or a patch later edited on main, reads
  // as landed. Content decides (scripts/lib/strandedContent.mjs, Q1146).
  if (unlanded === 0 && contentStranded) {
    return { name, action: "UNLANDED", reason: "every patch is on main but some of its content is not (a merge resolution or an edit)" };
  }
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
 * A deliberately broken branch is never auto-landed. A red proof (a guard's
 * check removed to show the guard can fail) is pushed only so CI can run it;
 * on 2026-10-06 this script opened auto-land #2444 for q975-red-proof WITH
 * auto-merge on, and its only change (a weakened CI race runner) would have
 * passed every required check and merged. Marked by its branch name or by any
 * unlanded commit subject.
 */
export const NEVER_LAND_SUBJECT = /\b(?:RED PROOF|DO NOT LAND)\b/i;
export const NEVER_LAND_BRANCH = /(?:^|[/-])red-proof(?:$|[/-])|-red$/;
export function neverLand(name, uncovered = []) {
  return NEVER_LAND_BRANCH.test(name) || uncovered.some((c) => NEVER_LAND_SUBJECT.test(c?.subject ?? ""));
}

/**
 * Pure: is this branch stranded work (pushed, unlanded, no PR, not new)?
 * @param {{ name: string, hasOpenPr: boolean, ageHours: number, uncovered: unknown[], accepted?: boolean, contentOnMain?: boolean }} b
 */
export function isStranded({ name, hasOpenPr, ageHours, uncovered, accepted = false, contentOnMain = false, contentInOpenPr = false }) {
  if (PROTECTED.has(name)) return false;
  if (hasOpenPr) return false;
  // A lane's claim marker, never work to land (#2814, #2815).
  if (NEVER_AUTO_LAND_PREFIXES.some((p) => name.startsWith(p))) return false;
  // Its unlanded content is already in another open PR: that PR lands it.
  if (contentInOpenPr) return false;
  // Its CONTENT is on main (scripts/lib/strandedContent.mjs, the test
  // `npm run stranded` uses): what is left by commit identity is regenerated
  // files or superseded edits, not work. 2026-10-11: origin/fix/no-false-signout
  // merged via #2689, but its inventory refresh and coverage-floor bump stayed
  // "+" in git cherry, so every run re-opened an auto-land PR (#2696, #2707, #2712).
  if (contentOnMain) return false;
  // Content-checked and recorded as deliberately not landed (its work went to
  // main another way): never re-open an auto-land PR for it (2026-10-04: the
  // closed cloud PRs came back as #2277-#2280 every run).
  if (accepted) return false;
  if (neverLand(name, uncovered)) return false;
  if (!(ageHours >= STRANDED_AFTER_HOURS)) return false;
  return uncovered.length > 0;
}

/** id -> sha from docs/audit/stranded-accepted.json (the stranded-work check's own record). */
export function readAcceptedTips(file = "docs/audit/stranded-accepted.json") {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const e of JSON.parse(readFileSync(file, "utf8")).accepted ?? []) out.set(e.id, e.sha);
  return out;
}

/**
 * Which remote branches are STRANDED (each gets an auto-land PR with --apply).
 * Commit identity (patch + subject) shortlists; CONTENT decides: a shortlisted
 * branch whose content is on main goes to `contentOnMain`, never `stranded`.
 * @param {(args: string[]) => string} gitFn runs git in the repo
 * @param {{ name: string, sha: string, ageHours: number }[]} branches
 * @param {Set<string>} openHeads
 * @param {Map<string, string>} acceptedTips
 * A content-stranded branch whose unlanded content another open PR already
 * carries (`contentInOpenPrOf`) goes to `inOpenPr`, never `stranded`.
 * @param {(name: string) => boolean} contentStrandedOf
 * @param {(name: string) => boolean} [contentInOpenPrOf]
 */
export function findStranded(gitFn, branches, openHeads, acceptedTips, contentStrandedOf, contentInOpenPrOf = () => false) {
  const tipOf = new Map(branches.map((b) => [b.name, b.sha]));
  // Subjects already on main (recent history) or on any open PR's head.
  const covered = new Set(gitFn(["log", "--format=%s", "-n", "5000", "origin/main"]).split("\n"));
  for (const head of openHeads) {
    if (!tipOf.has(head)) continue;
    for (const s of gitFn(["log", "--format=%s", `origin/main..origin/${head}`]).split("\n")) covered.add(s);
  }
  const stranded = [];
  const contentOnMain = [];
  const inOpenPr = [];
  for (const { name, ageHours } of branches) {
    const hasOpenPr = openHeads.has(name);
    if (PROTECTED.has(name) || hasOpenPr || !(ageHours >= STRANDED_AFTER_HOURS)) continue;
    const uncovered = uncoveredCommits(gitFn(["cherry", "-v", "origin/main", `origin/${name}`]), covered);
    const accepted = acceptedTips.get(`remote:origin/${name}`) === tipOf.get(name);
    if (!isStranded({ name, hasOpenPr, ageHours, uncovered, accepted })) continue;
    if (!isStranded({ name, hasOpenPr, ageHours, uncovered, accepted, contentOnMain: !contentStrandedOf(name) })) {
      contentOnMain.push({ name, ageHours, uncovered });
    } else if (!isStranded({ name, hasOpenPr, ageHours, uncovered, accepted, contentInOpenPr: contentInOpenPrOf(name) })) {
      inOpenPr.push({ name, ageHours, uncovered });
    } else {
      stranded.push({ name, ageHours, uncovered });
    }
  }
  return { stranded, contentOnMain, inOpenPr };
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

function listOpenPrs() {
  const out = execFileSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "1000", "--json", "number,headRefName,title,createdAt"],
    { encoding: "utf8" },
  );
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) throw new Error("gh pr list did not return an array");
  return rows;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function main() {
  const apply = process.argv.includes("--apply");
  const openPrs = listOpenPrs();
  const openHeads = new Set(openPrs.map((r) => r.headRefName));
  const branches = listRemoteBranches();
  const tipOf = new Map(branches.map((b) => [b.name, b.sha]));
  let mainIndex = null;
  const run = gitRunner(process.cwd());
  const contentOf = new Map();
  const contentResult = (name) => {
    mainIndex ??= buildMainIndex(run, "origin/main");
    if (!contentOf.has(name)) contentOf.set(name, unlandedContent(run, `origin/${name}`, "origin/main", mainIndex));
    return contentOf.get(name);
  };
  const contentStrandedOf = (name) => contentResult(name).stranded;
  // Lines every open PR's head adds/removes, pooled; built once, on first use.
  let openPrIndex = null;
  const contentInOpenPrOf = (name) => {
    openPrIndex ??= buildRefsContentIndex(run, "origin/main", [...openHeads].filter((h) => tipOf.has(h)).map((h) => `origin/${h}`));
    return contentCoveredBy(contentResult(name), openPrIndex);
  };
  const rows = branches.map(({ name, ageHours }) => {
    const facts = {
      name,
      ageHours,
      hasOpenPr: openHeads.has(name),
      cherryOutput:
        isProtected(name) || openHeads.has(name) ? "" : git(["cherry", "origin/main", `origin/${name}`]),
    };
    const first = decideBranch(facts);
    if (first.action !== "DELETE") return first;
    // Only a would-be delete pays for the content check; the index is built once.
    return decideBranch({ ...facts, contentStranded: contentStrandedOf(name) });
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

  const { stranded, contentOnMain, inOpenPr } = findStranded(git, branches, openHeads, readAcceptedTips(), contentStrandedOf, contentInOpenPrOf);
  for (const b of contentOnMain) {
    console.log(`content on main, no auto-land PR: ${b.name} (${b.uncovered.length} commit(s) left by identity: ${b.uncovered.map((c) => c.subject).join("; ")})`);
  }
  for (const b of inOpenPr) {
    console.log(`content already in an open PR, no auto-land PR: ${b.name}`);
  }
  const budget = autoLandBudget(openPrs);
  const toOpen = stranded.slice(0, budget);
  const deferred = stranded.slice(budget);
  for (const b of deferred) {
    console.log(`auto-land deferred to a later run (cap ${MAX_AUTO_LAND_PER_RUN} per run, ${MAX_OPEN_AUTO_LAND} open): ${b.name}`);
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
  const autoOpened = [];
  if (apply) {
    for (const b of toOpen) {
      try {
        const body =
          `Opened by branch-prune: \`${b.name}\` held ${b.uncovered.length} commit(s) on neither main nor an open PR ` +
          `for ${Math.round(b.ageHours)}h.\n\n${b.uncovered.map((c) => `- ${c.sha.slice(0, 9)} ${c.subject}`).join("\n")}\n\n` +
          `Rebase auto-merge is on; the required checks decide. Still open after ${AUTO_LAND_STUCK_HOURS}h turns branch-prune red.`;
        const url = gh(["pr", "create", "--base", "main", "--head", b.name, "--title", autoLandTitle(b.name), "--body", body]).trim();
        gh(["pr", "merge", url, "--rebase", "--auto"]);
        autoOpened.push({ name: b.name, url });
        console.log(`auto-land PR ${url} for ${b.name}`);
      } catch (e) {
        failed++;
        console.error(`FAILED to open auto-land PR for ${b.name}: ${e.message}`);
      }
    }
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

  const stuck = stuckAutoLandPrs(openPrs, Date.now());
  for (const p of stuck) {
    console.log(`STUCK: auto-land PR #${p.number} (${p.headRefName}) open over ${AUTO_LAND_STUCK_HOURS}h: fix its conflict or red check`);
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
    if (autoOpened.length) {
      md += `\n### Auto-land PRs opened\n\n${autoOpened.map((a) => `- \`${a.name}\`: ${a.url}`).join("\n")}\n`;
    }
    if (deferred.length) {
      md += `\n### Auto-land deferred (cap ${MAX_AUTO_LAND_PER_RUN} per run, ${MAX_OPEN_AUTO_LAND} open)\n\n${deferred.map((b) => `- \`${b.name}\``).join("\n")}\n`;
    }
    if (inOpenPr.length) {
      md += `\n### Content already in an open PR (no auto-land PR)\n\n${inOpenPr.map((b) => `- \`${b.name}\``).join("\n")}\n`;
    }
    if (stuck.length) {
      md += `\n### STUCK auto-land PRs (red)\n\n${stuck.map((p) => `- #${p.number} \`${p.headRefName}\``).join("\n")}\n`;
    }
    appendFileSync(summary, md);
  }
  // With --apply a stranded branch now has an auto-land PR, so it is handled;
  // a dry run still exits 1 on it. A stuck auto-land PR is always red.
  if (failed || stuck.length || (!apply && stranded.length)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
