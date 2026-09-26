#!/usr/bin/env node
/**
 * Report money / authz / data-model commits that landed with no recorded review
 * (docs/OPEN.md Q9). Rules: scripts/lib/sensitiveReview.mjs. Guard:
 * src/test/sensitiveReview.test.ts. Workflow: .github/workflows/sensitive-review.yml.
 *
 *   node scripts/check-sensitive-review.mjs [--range A..B] [--strict]
 *       Default range: origin/main (every commit on main since START_DATE;
 *       --since <date> measures an older window, e.g. for a report).
 *       Prints the report (and appends it to $GITHUB_STEP_SUMMARY). Exit 0
 *       unless --strict, which exits 1 while any sensitive commit is unreviewed;
 *       only the push-to-main job passes --strict, so main shows it red and the
 *       ops-alert ledger item stays open until the review is recorded. It never
 *       blocks a PR or a push.
 *
 *   node scripts/check-sensitive-review.mjs record <sha> <reviewer> <verdict...>
 *       Records a review after the fact in docs/reviews/sensitive-reviews.jsonl.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { REVIEWERS, START_DATE, audit, parseLog } from "./lib/sensitiveReview.mjs";

export const LOG = "docs/reviews/sensitive-reviews.jsonl";
const args = process.argv.slice(2);
const git = (a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });

if (args[0] === "record") {
  const [, sha, reviewer, ...verdict] = args;
  if (!sha || !REVIEWERS.includes(reviewer) || !verdict.length) {
    console.error(`usage: record <sha> <${REVIEWERS.join("|")}> <verdict...>`);
    process.exit(2);
  }
  const full = git(["rev-parse", "--verify", `${sha}^{commit}`]).trim();
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify({ sha: full, reviewer, verdict: verdict.join(" "), date: new Date().toISOString().slice(0, 10) }) + "\n");
  console.log(`recorded ${reviewer} review of ${full.slice(0, 9)} in ${LOG}`);
  process.exit(0);
}

const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const range = opt("--range") ?? "origin/main";
const strict = args.includes("--strict");
const since = opt("--since") ?? START_DATE; // --since only to MEASURE history; the gate window is START_DATE

const SEP = "\u001e";
const raw = git(["log", "--no-merges", `--since=${since}T00:00:00`, "--name-only", `--format=${SEP}%H%x1f%cI%x1f%B%x1f`, range]);
const commits = raw.split(SEP).filter(Boolean).map((chunk) => {
  const [sha, date, message, files = ""] = chunk.split("\u001f");
  return { sha, date, message, files: files.split("\n").map((f) => f.trim()).filter(Boolean) };
});
const { bySha, errors } = parseLog(existsSync(LOG) ? readFileSync(LOG, "utf8") : "");
const { rows, missing } = audit(commits, bySha, { since });

const lines = [
  `### Money / authz / data-model review record (Q9)`,
  ``,
  `Range \`${range}\` since ${since}: ${commits.length} commit(s), ${rows.length} touch a sensitive path, **${missing.length} with no recorded review**.`,
  ``,
];
for (const r of missing) lines.push(`- \`${r.sha.slice(0, 9)}\` ${r.message.split("\n")[0].slice(0, 90)} — ${r.sensitive.slice(0, 3).join(", ")}${r.sensitive.length > 3 ? ` (+${r.sensitive.length - 3})` : ""}`);
if (missing.length) {
  lines.push("", `Record each: run the review-only pass (${REVIEWERS.slice(0, 5).join(", ")}), then either add a \`Sensitive-Review: <reviewer>: <verdict>\` trailer to the commit or \`node scripts/check-sensitive-review.mjs record <sha> <reviewer> <verdict>\`.`);
}
for (const e of errors) lines.push(`- ${LOG} ${e}`);
const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
for (const r of missing) console.log(`::warning title=Unreviewed money/authz/data-model commit (Q9)::${r.sha.slice(0, 9)} ${r.message.split("\n")[0].slice(0, 120)}`);
if (strict && (missing.length || errors.length)) process.exit(1);
