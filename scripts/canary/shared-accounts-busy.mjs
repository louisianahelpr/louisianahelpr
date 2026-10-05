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

// A run "in progress" longer than this is a GitHub ghost, not a lock holder:
// its queue job dies at 350 min and the longest lock job (prod-audit) at 180,
// so a real run is done inside ~8.8 h. Same value as
// scripts/e2e/wait-shared-accounts.mjs STALE_RUN_MS. On 2026-10-01 e2e-real-backend run 36796252514 sat in_progress for 14 h+
// while every cancel answered "not in progress"; the canary stood down hourly
// behind it and nightly-red #1957 could never clear.
export const STALE_RUN_MS = 10 * 60 * 60 * 1000;

/**
 * A vacuity.yml PUSH run signs in as the shared accounts while its
 * `vacuity-e2e` job (display name below) runs the Playwright registrations
 * under the account lock (Q551). Its other jobs never do. Q1271.
 */
export const VACUITY_WORKFLOW = "vacuity.yml";
export const VACUITY_E2E_JOB = "Playwright guards shown able to fail";

/**
 * Does this in_progress run really hold the shared accounts now?
 * `jobs` (the run's jobs, from the API) is read only for a vacuity.yml push run.
 */
export function holdsAccounts(run, now = Date.now(), jobs = []) {
  if (run.event === "push") {
    if (!String(run.path ?? "").endsWith(`/${VACUITY_WORKFLOW}`)) return false;
    return jobs.some((j) => j.name === VACUITY_E2E_JOB && j.status === "in_progress");
  }
  if (!DRIVES_ACCOUNTS.has(run.event)) return false;
  // A main batch (scripts/ci/main-batch.mjs) is e2e-real-backend's old push
  // leg, dispatched: its account jobs are gated off `inputs.batch` (2026-10-02).
  if (String(run.display_title ?? "").includes("(main batch ")) return false;
  const started = Date.parse(run.run_started_at ?? run.created_at ?? "");
  return !(Number.isFinite(started) && now - started > STALE_RUN_MS);
}

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
      // Scheduled and dispatched runs sign in as the shared accounts; of the
      // push runs only vacuity.yml's, and only while its vacuity-e2e job runs
      // (Q1271). main takes pushes all day, so counting the rest would stand
      // the canary down for nothing.
      for (const run of runs) {
        let jobs = [];
        if (f === VACUITY_WORKFLOW && run.event === "push") {
          const jr = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!jr.ok) throw new Error(`jobs of run ${run.id}: HTTP ${jr.status}`);
          jobs = (await jr.json()).jobs ?? [];
        }
        if (holdsAccounts(run, Date.now(), jobs)) busy.push(`${f} ${run.html_url}`);
        else if (DRIVES_ACCOUNTS.has(run.event))
          console.log(`::warning title=Ignoring a stale run::${f} ${run.html_url} has been in progress over ${STALE_RUN_MS / 3_600_000} h; GitHub ghost, not a lock holder.`);
      }
    } catch (e) {
      console.log(`::warning title=Canary could not check ${f}::${e instanceof Error ? e.message : e} — counted as not busy, the canary runs.`);
    }
  }
  console.log(`Shared-account workflows checked (${files.length}): ${files.join(", ")}`);
  out("busy", busy.length ? "true" : "false");
  out("reason", busy.length ? `shared accounts in use by ${busy.join("; ")}` : "shared accounts free");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
