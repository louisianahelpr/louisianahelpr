#!/usr/bin/env node
/**
 * THE gate. One command, so "I ran the checks" has exactly one meaning.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * CLAUDE.md has said since forever: "Gate repo-wide: `npm run typecheck` plus
 * `npx vitest run` across the whole repo, never just touched files". On
 * 2026-09-22 I broke that rule repeatedly in one session and it cost the whole
 * evening:
 *
 *   · four new guards shipped with a comment stripper that DELETES the code it
 *     searches. `guardsDoNotDeleteSource.test.ts` catches exactly that — I had
 *     not run it;
 *   · a migration shipped reading `public.jobs` without a row lock.
 *     `check-race-class.mjs` catches exactly that — it is a NIGHTLY, so it told
 *     me by turning race-runner red;
 *   · an alerting policy change left five test files asserting the old rule,
 *     and a sixth HANGING on an infinite render loop the change introduced.
 *
 * Not one of those was a missing check. Every single one already had a guard
 * that was right. They were all the same failure: I ran SOME checks, believed
 * I had run THE checks, and pushed.
 *
 * A list of commands in a document does not fix that, because the failure mode
 * is running a subset and believing it was the whole. So the fix is a single
 * command that runs the whole thing and, crucially, REPORTS WHAT IT RAN — a
 * skipped step is printed as SKIPPED and fails the gate, so a partial run can
 * never be mistaken for a clean one.
 *
 *   npm run gate            # everything (what you run before a push)
 *   npm run gate -- --fast  # everything except the repo-wide vitest
 *
 * `--fast` exists because this Mac has 8 GB and the suite is ~2,840 tests; it
 * prints, loudly, that the slow half did not run. That is the point: an honest
 * partial is fine, a partial believed to be complete is not.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FAST = process.argv.includes("--fast");

/** [label, command, { skipIf?, why? }] — order is cheapest-first. */
const STEPS = [
  ["typecheck (app + edge)", "npm run typecheck"],
  ["eslint", "npx eslint src e2e scripts --max-warnings=9999"],
  ["CLAUDE.md claims", "npm run check:claude-md"],
  ["race class (migrations + src)", "node scripts/check-race-class.mjs"],
  ["migration raise codes", "node scripts/check-migration-raise-codes.mjs"],
  ["migration relation grants", "node scripts/check-migration-relation-grants.mjs"],
  ["migration timestamps", "node scripts/check-migration-versions.mjs"],
  ["loading-state shape", "npm run check:loading-states"],
  ["generated inventories current", "npm run check:generated"],
  ["stated counts dated", "npm run check:counts"],
  [
    "deferred vendors (built graph)",
    "npm run check:deferred-vendors",
    {
      skipIf: () => !existsSync("dist/index.html"),
      why: "no dist/ — run `npm run build` first if you touched the bundle",
    },
  ],
  [
    "critical-path budget (built graph, Q178)",
    "node scripts/perf/critical-path.mjs --check",
    {
      skipIf: () => !existsSync("dist/index.html"),
      why: "no dist/ — run `npm run build` first if you touched the bundle",
    },
  ],
  ["repo-wide vitest", "npx vitest run", { skipIf: () => FAST, why: "--fast" }],
];

const results = [];
let failed = 0;

for (const [label, cmd, opts = {}] of STEPS) {
  if (opts.skipIf?.()) {
    results.push(["SKIPPED", label, opts.why ?? ""]);
    continue;
  }
  process.stdout.write(`\n── ${label}\n`);
  try {
    execSync(cmd, { stdio: "inherit" });
    results.push(["ok", label, ""]);
  } catch {
    results.push(["FAILED", label, ""]);
    failed += 1;
  }
}

console.log("\n" + "=".repeat(64));
for (const [state, label, note] of results) {
  const mark = state === "ok" ? "✓" : state === "SKIPPED" ? "–" : "✗";
  console.log(`  ${mark} ${state.padEnd(8)} ${label}${note ? `  (${note})` : ""}`);
}

const skipped = results.filter((r) => r[0] === "SKIPPED");
console.log("=".repeat(64));

// The scoreboard's `npm run gate` row (docs/SCOREBOARD.md, Q59) reads this. It
// lives OUTSIDE the repo (a per-machine record of the last local gate, never
// committed); a machine with no record shows that row as UNKNOWN, never green.
try {
  let head = "";
  try { head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  const dir = join(homedir(), ".lh-gate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "last.json"),
    JSON.stringify({ measuredAt: new Date().toISOString(), head, fast: FAST, steps: results.map(([state, label, note]) => ({ state, label, note })) }, null, 2),
  );
} catch { /* a record we cannot write must not change the gate's verdict */ }

if (failed) {
  console.error(`\n${failed} step(s) FAILED. Do not push.`);
  process.exit(1);
}
if (skipped.length) {
  // Not an error, but never silent: the whole reason this file exists is that a
  // partial run got mistaken for a complete one.
  console.log(
    `\nPASSED, but ${skipped.length} step(s) did not run:\n` +
      skipped.map((s) => `    - ${s[1]} (${s[2]})`).join("\n") +
      `\nThis is NOT a clean gate. Say so if you report it.`,
  );
  process.exit(0);
}
console.log("\nAll steps ran and passed.");
