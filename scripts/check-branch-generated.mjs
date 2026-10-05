#!/usr/bin/env node
/**
 * BRANCHES ONLY CHANGE REAL THINGS (owner, 2026-10-05): a branch never commits a
 * generated file. One bot on main owns every number.
 *
 * Why. Every landing used to regenerate the whole-tree outputs (the queue score
 * line and Everything-open block in docs/OPEN.md, docs/SCOREBOARD.md,
 * docs/GUARD-BURNDOWN.md, the vacuity report, the done-item archives ...), so two
 * landings from one base touched the same lines: they conflicted, or merged
 * cleanly to the wrong total. Measured on 2026-10-05 (two branches from 2a2d33528,
 * each adding one test and one OPEN.md item, refreshed as the agent brief then
 * said): rebasing the second onto the first stopped on docs/OPEN.md (3 hunks: the
 * Everything-open line, the queue line, the item) and docs/SCOREBOARD.md.
 *
 * Now the protected set is DERIVED from the generator registry
 * (scripts/check-generated-current.mjs isProtectedPath: every CI generator's
 * outputs except the authored docs/OPEN.md, plus every dated done-item archive),
 * and this refuses a branch whose changes touch one. staleness-watch.yml
 * regenerates main after every merge and lands it as bot/refresh/inventories;
 * that bot (any bot/refresh/* branch) is exempt.
 *
 *   node scripts/check-branch-generated.mjs [--base <rev>] [--head <rev>] [--branch <name>]
 *       exit 1 when <base>..<head> changes a protected path (or re-adds a
 *       generated block to docs/OPEN.md). <base> is the commit the branch's
 *       changes apply to: origin/main after land.sh's rebase, the merge ref's
 *       first parent in PR CI. Defaults: origin/main, HEAD, the current branch.
 *   ... --restore      put every protected path back to <base>'s copy (land.sh
 *                      commits the result), then exit 0
 *   ... --classify <path>...   print the given paths that are protected (land.sh
 *                      resolves a rebase conflict on them by taking main's side)
 *
 * Run by: scripts/land.sh (restore, then check), the required "Lint, type-check,
 * build, test" job in test.yml (pull_request), and `npm run gate`.
 * Guard: src/test/branchesNeverEditGenerated.test.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isProtectedPath } from "./check-generated-current.mjs";

const REPO = resolve(import.meta.dirname, "..");
const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });

/** The bot's own branches (.github/actions/refresh-pr: bot/refresh/<id>). */
export const BOT_BRANCH = /^bot\/refresh\/[a-z0-9-]+$/;

/** A generated block marker; docs/OPEN.md must never carry one again. */
export const GENERATED_MARKER = "<!-- generated:";

/**
 * The verdict for one branch. `changed` = paths <base>..<head> touches;
 * `openText` = docs/OPEN.md at <head> (null when absent).
 */
export function branchProblems({ changed, branch = "", openText = null }) {
  if (BOT_BRANCH.test(branch)) return [];
  const problems = changed.filter(isProtectedPath).map((p) => `${p} is generated: only the main bot writes it`);
  if (changed.includes("docs/OPEN.md") && openText?.includes(GENERATED_MARKER)) {
    problems.push(`docs/OPEN.md carries a "${GENERATED_MARKER}" block again: OPEN.md holds items only; counts are generated into docs/SCOREBOARD.md on main`);
  }
  return problems;
}

function opt(argv, name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? String(argv[i + 1] ?? "") : dflt;
}

function currentBranch() {
  try { return git("rev-parse", "--abbrev-ref", "HEAD").trim(); } catch { return ""; }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--classify")) {
    const paths = argv.slice(argv.indexOf("--classify") + 1).filter((a) => !a.startsWith("--"));
    for (const p of paths) if (isProtectedPath(p)) console.log(p);
    return;
  }
  const head = opt(argv, "head", "HEAD");
  // Judged from the merge base, so a main that moved on since the branch
  // forked never reads as the branch reverting main's files.
  const base = git("merge-base", opt(argv, "base", "origin/main"), head).trim();
  const branch = opt(argv, "branch", currentBranch());
  const changed = git("diff", "--name-only", "--no-renames", base, head).split("\n").filter(Boolean);

  if (argv.includes("--restore")) {
    const restore = changed.filter(isProtectedPath);
    for (const p of restore) {
      let atBase = true;
      try { git("cat-file", "-e", `${base}:${p}`); } catch { atBase = false; }
      if (atBase) git("checkout", base, "--", p);
      else { try { git("rm", "-q", "--cached", "--", p); } catch { /* untracked at HEAD: removing the file is enough */ } rmSync(join(REPO, p), { force: true }); }
      console.log(`restored ${p} to ${base}'s copy (the main bot regenerates it)`);
    }
    if (!restore.length) console.log("branch-generated: nothing to restore.");
    return;
  }

  let openText = null;
  try { openText = head === "HEAD" && existsSync(join(REPO, "docs/OPEN.md")) ? readFileSync(join(REPO, "docs/OPEN.md"), "utf8") : git("show", `${head}:docs/OPEN.md`); } catch { /* no OPEN.md at head */ }
  if (BOT_BRANCH.test(branch)) {
    console.log(`branch-generated: ${branch} is the main bot's own branch; exempt.`);
    return;
  }
  const problems = branchProblems({ changed, branch, openText });
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(
      `branch-generated: ${problems.length} generated file(s) changed on ${branch || "this branch"} (${base}..${head}). ` +
        "Branches only change real things; staleness-watch.yml regenerates every generated file on main after the merge " +
        "and lands it as bot/refresh/inventories. Fix: `node scripts/check-branch-generated.mjs --restore` and commit " +
        "(scripts/land.sh does this for you).",
    );
    process.exit(1);
  }
  console.log(`branch-generated: OK — ${changed.length} changed path(s) on ${branch || "this branch"}, none generated.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
