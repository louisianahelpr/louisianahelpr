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

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
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
for (const f of ["CLAUDE.md", "docs/OPEN.md"]) {
  const [added, removed] = sh(`git diff --numstat ${base} HEAD -- ${f}`).split(/\s+/).map(Number);
  if (removed - added > 10) problems.push(`${f}: net ${removed - added} line(s) removed`);
}
if (problems.length) {
  console.error("[push-guard] This push removes work that is on origin/main:\n  - " + problems.join("\n  - "));
  console.error("If that is really intended, add [intentional-revert] and the reason to a commit message.");
  process.exit(1);
}
