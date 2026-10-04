#!/usr/bin/env node
/**
 * No commit of a landing may close a nightly-red issue (docs/OPEN.md Q1184).
 * Rules: scripts/lib/closingRefs.mjs. Guard: src/test/closingKeywordNightlyRed.test.ts.
 *
 *   node scripts/check-closing-keywords.mjs [--range A..B]
 *       Default range: origin/main..HEAD (what a land would add). Reads the FULL
 *       message of every commit in it, and for each issue a closing keyword
 *       names asks `gh issue view N --json labels`. Exits 1 when one carries
 *       nightly-red, and ALSO when gh cannot answer (fail closed): scripts/land.sh
 *       refuses the push either way. An alert closes only when its own workflow
 *       goes green, never from a commit body.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { judgeClosers, NIGHTLY_RED, refText } from "./lib/closingRefs.mjs";

const args = process.argv.slice(2);
const rangeAt = args.indexOf("--range");
const range = rangeAt >= 0 ? args[rangeAt + 1] : "origin/main..HEAD";
if (!range || !range.includes("..")) {
  console.error("usage: check-closing-keywords.mjs [--range A..B]");
  process.exit(2);
}

const log = execFileSync("git", ["log", "--no-merges", "--format=%H%x1f%B%x1e", range], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
});
const commits = log
  .split("\x1e")
  .map((r) => r.replace(/^\n/, ""))
  .filter((r) => r.trim())
  .map((r) => {
    const [sha, ...rest] = r.split("\x1f");
    return { sha, message: rest.join("\x1f") };
  });

function labelsOf(ref) {
  const argv = ["issue", "view", String(ref.number), "--json", "labels"];
  if (ref.repo) argv.push("--repo", ref.repo);
  const r = spawnSync("gh", argv, { encoding: "utf8", timeout: 60_000 });
  if (r.error) throw new Error(`gh did not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh exited ${r.status}: ${(r.stderr || "").trim().split("\n")[0]}`);
  const parsed = JSON.parse(r.stdout);
  if (!parsed || !Array.isArray(parsed.labels)) throw new Error("gh printed no labels list");
  return parsed.labels.map((l) => l?.name);
}

const { blocked, unanswered } = judgeClosers(commits, labelsOf);
for (const b of blocked)
  console.error(
    `land: ${b.sha.slice(0, 9)} closes ${refText(b.ref)}, which carries the ${NIGHTLY_RED} label. ` +
      `An alert closes when its workflow goes green, not from a commit message: reword the keyword ` +
      `(say "see ${refText(b.ref)}"), then re-run bash scripts/land.sh.`,
  );
for (const u of unanswered)
  console.error(
    `land: ${u.sha.slice(0, 9)} says it closes ${refText(u.ref)} and gh could not say whether that issue ` +
      `is ${NIGHTLY_RED} (${u.why}). Refusing (fail closed): fix gh access, or reword the keyword.`,
  );
if (blocked.length || unanswered.length) process.exit(1);
console.log(`land: no commit in ${range} closes a ${NIGHTLY_RED} issue (${commits.length} commit message(s) read).`);
