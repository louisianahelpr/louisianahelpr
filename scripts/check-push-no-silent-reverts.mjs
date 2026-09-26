#!/usr/bin/env node
/**
 * Pre-push guard against a push that silently undoes other people's work.
 *
 * 2026-09-12: an audit lane soft-reset its WIP onto an origin/main that had
 * moved, which staged the REVERSAL of other sessions' commits, and pushed it
 * unchecked. It deleted a just-shipped migration and stripped CLAUDE.md's new
 * standing orders; a follow-up restored them a minute later, but a
 * db-deploy in that window would have run without the migration.
 *
 * Fails the push when, relative to origin/main, it:
 *   - deletes or renames any file under supabase/migrations/, or
 *   - SHRINKS CLAUDE.md or docs/OPEN.md by more than 10 lines net (ticking a
 *     box or rewording is +n/-n and passes; a revert is a large net loss),
 * unless a commit in the push says "[intentional-revert]" and why.
 */
import { execSync } from "node:child_process";

const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

/** Lines a unified diff adds ("+") or removes ("-"), without the file headers. */
export function changedLines(diff, sign) {
  return diff.split("\n").filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3) + " ")).map((l) => l.slice(1));
}

/** Removed minus added lines, not counting removed lines that `movedTo` received. */
export function netLoss(diff, movedTo) {
  const removed = changedLines(diff, "-").filter((l) => !movedTo.has(l)).length;
  return removed - changedLines(diff, "+").length;
}
if (import.meta.url === `file://${process.argv[1]}`) main();

function main() {
let base;
try { base = sh("git merge-base HEAD origin/main"); } catch { process.exit(0); /* no remote to compare against */ }
const range = `${base}..HEAD`;
const msgs = sh(`git log --format=%B ${range}`);
if (/\[intentional-revert\]/.test(msgs)) process.exit(0);

const problems = [];
const status = sh(`git diff --name-status ${base} HEAD -- supabase/migrations`);
for (const line of status.split("\n").filter(Boolean)) {
  if (/^[DR]/.test(line)) problems.push(`migration deleted/renamed: ${line}`);
}
// OPEN.md's done items MOVE, verbatim, to docs/archive/OPEN-done-*.md
// (scripts/archive-done.mjs, Q16). A removed OPEN.md line that the same push
// adds to an archive is kept, not lost; only the rest counts.
const archived = new Set(changedLines(sh(`git diff -U0 ${base} HEAD -- ":(glob)docs/archive/OPEN-done-*.md"`), "+"));
for (const f of ["CLAUDE.md", "docs/OPEN.md"]) {
  const lost = netLoss(sh(`git diff -U0 ${base} HEAD -- ${f}`), f === "docs/OPEN.md" ? archived : new Set());
  if (lost > 10) problems.push(`${f}: net ${lost} line(s) removed`);
}
if (problems.length) {
  console.error("[push-guard] This push removes work that is on origin/main:\n  - " + problems.join("\n  - "));
  console.error("If that is really intended, add [intentional-revert] and the reason to a commit message.");
  process.exit(1);
}
}
