#!/usr/bin/env node
/**
 * Bot-workflow watchdog (owner, 2026-10-12). Reads every workflow's state
 * over REST (`gh api repos/{owner}/{repo}/actions/workflows`) and exits 1 when
 * any workflow on REQUIRED_ACTIVE (scripts/lib/requiredActiveWorkflows.mjs) is
 * not `active` (disabled_manually, disabled_inactivity, deleted, or missing).
 * Exit 2 when the state cannot be read: fail closed, "could not tell" is red.
 *
 * Runs in staleness-watch.yml and branch-prune.yml (two watchers).
 * Guard: src/test/requiredActiveWorkflows.test.ts.
 *
 * Usage: node scripts/check-workflows-active.mjs [--from <file.tsv>]
 *   --from: read "path<TAB>state" lines from a file instead of the API (tests).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_ACTIVE, inactiveRequired } from "./lib/requiredActiveWorkflows.mjs";

/** "path\tstate" lines -> rows. */
export function parseStates(tsv) {
  return String(tsv)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [path, state] = l.split("\t");
      return { path, state };
    });
}

function main() {
  const argv = process.argv.slice(2);
  const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : null;
  let rows;
  try {
    const tsv = from
      ? readFileSync(from, "utf8")
      : execFileSync("gh", ["api", "--paginate", "repos/{owner}/{repo}/actions/workflows", "--jq", ".workflows[] | [.path, .state] | @tsv"], { encoding: "utf8" });
    rows = parseStates(tsv);
  } catch (e) {
    console.log(`::error title=workflow watchdog::could not read workflow states: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(2);
  }
  // Floor: an empty or truncated listing must not read as "nothing disabled".
  if (rows.length < REQUIRED_ACTIVE.length) {
    console.log(`::error title=workflow watchdog::the API listed ${rows.length} workflows, fewer than the ${REQUIRED_ACTIVE.length} required ones; the read is incomplete`);
    process.exit(2);
  }
  const bad = inactiveRequired(rows);
  console.log(`${REQUIRED_ACTIVE.length} required workflow(s) checked, ${rows.length} listed by the API, ${bad.length} not active.`);
  for (const w of bad) {
    console.log(`::error title=workflow disabled::${w.file} is ${w.state}. Nothing it does runs while it stays that way. Re-enable: gh workflow enable ${w.file} (and record why it was disabled in docs/OPEN.md).`);
  }
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
