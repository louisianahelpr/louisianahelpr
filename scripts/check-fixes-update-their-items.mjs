#!/usr/bin/env node
/**
 * Every commit that names an open docs/OPEN.md item updates that item in the
 * same landing (docs/OPEN.md Q1150). Rules: scripts/lib/fixUpdatesItem.mjs.
 * Guard: src/test/fixUpdatesItem.test.ts.
 *
 *   node scripts/check-fixes-update-their-items.mjs [--range A..B] [--strict]
 *       Default range: origin/main..HEAD (what a land would add). Prints the
 *       report (and appends it to $GITHUB_STEP_SUMMARY). --strict exits 1 while
 *       any named item is still open and untouched: scripts/land.sh refuses the
 *       push, and the required "Lint, type-check, build, test" job
 *       (.github/workflows/test.yml) refuses the PR.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parseCommits, unrecordedItems } from "./lib/fixUpdatesItem.mjs";

const OPEN = "docs/OPEN.md";
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const rangeAt = args.indexOf("--range");
const range = rangeAt >= 0 ? args[rangeAt + 1] : "origin/main..HEAD";
const [from, to] = (range ?? "").split("..");
if (!from || !to) {
  console.error("usage: check-fixes-update-their-items.mjs [--range A..B] [--strict]");
  process.exit(2);
}

const git = (a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
const openAt = (ref) => { try { return git(["show", `${ref}:${OPEN}`]); } catch { return ""; } };

const base = git(["merge-base", from, to]).trim();
const commits = parseCommits(git(["log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", `${from}..${to}`]));
const rows = unrecordedItems(commits, openAt(base), openAt(to), openAt(from));

const lines = [`### Open items named by this work (Q1150)`, ""];
lines.push(`Range \`${range}\`: ${commits.length} commit(s); **${rows.length} named item(s) still open and untouched**.`);
if (rows.length) {
  lines.push("", "| commit | item | subject |", "|---|---|---|");
  for (const r of rows) lines.push(`| ${r.sha.slice(0, 9)} | ${r.id} | ${r.subject.replace(/\|/g, "\\|")} |`);
  lines.push(
    "",
    "Each of these commits says it worked on an item, and the item's line in docs/OPEN.md was not changed.",
    "Update the line in this landing: tick it `- [x]` with the evidence (commit, the check that",
    "proves it), mark it `- [~]` with a `done-when:` marker for what is left, or add a dated",
    "`STATUS <date>:` note saying what this commit did and what remains.",
  );
}
const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
if (strict && rows.length) process.exit(1);
