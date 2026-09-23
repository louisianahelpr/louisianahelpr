#!/usr/bin/env node
/**
 * Is another suite driving the shared test accounts RIGHT NOW? (docs/OPEN.md Q61)
 *
 * The hourly core-loop canary applies to the same funded fixture job, as the
 * same helper-e2e, that prod-audit's interruption tests apply to; its
 * pre-sweep and ensureFundedOpenJob would also act on rows those suites are
 * mid-way through. Two runs on one pair of accounts turn each other red.
 *
 * The suites that drive those accounts serialise on the JOB-level group
 * `prod-lifecycle-shared-accounts`, but the canary cannot join it: GitHub keeps
 * ONE pending run per concurrency group, so an hourly canary queued there would
 * cancel a pending prod-audit or money-loop run (src/test/prodWorkflowSpacing
 * .test.ts, rule 4's story). So the canary ASKS instead, and stands down for
 * the hour when the accounts are busy — that suite is exercising the same loop.
 *
 * The workflow list is DERIVED from the tree: every workflow whose non-comment
 * lines name a shared-account secret (PLAYWRIGHT_POSTER_* / PLAYWRIGHT_HELPER_*),
 * minus the canary itself. A new suite on those accounts is covered the day it
 * lands.
 *
 * Output (GITHUB_OUTPUT): busy=true|false, reason=<text>. Exit 0 either way.
 * A GitHub API failure is NOT treated as busy: an unreadable answer must not
 * silence the canary, so it runs and says it could not check.
 */
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CANARY_WORKFLOW = "core-loop-canary.yml";
const DRIVES_ACCOUNTS = new Set(["schedule", "workflow_dispatch"]);
const SHARED_SECRET = /\bPLAYWRIGHT_(POSTER|HELPER)_(EMAIL|PASSWORD|SESSION)\b/;

/** Workflow files (basename) that drive the shared test accounts, the canary excluded. */
export function sharedAccountWorkflows(dir = join(process.cwd(), ".github", "workflows")) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && f !== CANARY_WORKFLOW)
    .filter((f) =>
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .some((l) => !/^\s*#/.test(l) && SHARED_SECRET.test(l.replace(/\s#.*$/, ""))),
    )
    .sort();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const out = (k, v) => {
    const line = `${k}=${String(v).replace(/\n/g, " ")}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    process.stdout.write(line);
  };
  const files = sharedAccountWorkflows();
  if (!repo || !token) {
    console.log("::warning title=Canary could not check the shared accounts::GITHUB_REPOSITORY/GITHUB_TOKEN unset; running anyway.");
    out("busy", "false");
    out("reason", "not checked (no GitHub token)");
    return;
  }
  const busy = [];
  for (const f of files) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${f}/runs?status=in_progress&per_page=5`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { workflow_runs: runs = [] } = await r.json();
      // Only scheduled and dispatched runs sign in as the shared accounts: the
      // push/PR legs of e2e-real-backend and vacuity do not, and main takes
      // pushes all day, so counting them would stand the canary down for nothing.
      for (const run of runs) if (DRIVES_ACCOUNTS.has(run.event)) busy.push(`${f} ${run.html_url}`);
    } catch (e) {
      console.log(`::warning title=Canary could not check ${f}::${e instanceof Error ? e.message : e} — counted as not busy, the canary runs.`);
    }
  }
  console.log(`Shared-account workflows checked (${files.length}): ${files.join(", ")}`);
  out("busy", busy.length ? "true" : "false");
  out("reason", busy.length ? `shared accounts in use by ${busy.join("; ")}` : "shared accounts free");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
