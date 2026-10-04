#!/usr/bin/env node
/**
 * THE PROD-LOAD QUEUE (docs/OPEN.md Q1161): first in, first served, whatever
 * hour GitHub delivers the cron.
 *
 * Every prod-hitting scheduled workflow used to take the workflow-level
 * concurrency group `prod-load`. GitHub keeps ONE pending run per group and
 * cancels the pending one when a third arrives, at WORKFLOW level, so nothing
 * in the run can report it. That held while crons arrived on time and two hours
 * apart. Measured over 84 scheduled prod-load runs (2026-09-24..10-03) they
 * arrive 127-501 minutes late (median 274), unevenly, so suites spaced two
 * hours apart bunch up and the third arrival cancels the second: write-contract-
 * refresh 37129164563 (2026-10-03), after seven schedule-stalled issues in ten
 * days. Q1160's re-dispatch recovers a lost run; it does not stop the loss, and
 * a bunch of runs piles onto the database exactly as the spacing rules (rules 3
 * and 5 of src/test/prodWorkflowSpacing.test.ts) were written to prevent.
 *
 * The fix is the one Q743 made for the shared-accounts lock
 * (scripts/e2e/wait-shared-accounts.mjs), taken one step further: a group alone
 * is not a queue, and here nothing may sit in a group at all. Each queued
 * workflow has its own per-run group (nothing to bump) and a first job
 * `prod-load-turn` that runs this script; every other job `needs:` it. The
 * script returns only when no OLDER scheduled run of a queued workflow is still
 * in flight, so scheduled runs go one at a time in the order GitHub delivered
 * them. Older = created first (created_at, then id): a total order, so two
 * runs can never wait on each other.
 *
 * What counts:
 *  - Only a run triggered by `schedule` waits and is waited for. A dispatch
 *    (a fix being re-verified, Q1160's re-dispatch) neither queues nor blocks,
 *    as before (rule 4 of prodWorkflowSpacing.test.ts).
 *  - A run is in flight from creation to completion: still waiting here, or
 *    running, counts as ahead of you.
 *  - A run created more than STALE_RUN_MS before this one is a GitHub ghost
 *    (14 h of in_progress on 2026-10-01, e2e-real-backend 36796252514) and is
 *    ignored, exactly as the shared-accounts queue ignores it.
 *
 * Failure modes: a rate-limited API read waits for the reset. A GitHub job
 * cannot run past 360 minutes and a queue of long suites can be longer (press-
 * every-control ran 6 h 13 min on 2026-10-03), so after WAIT_BUDGET_MS (340 min,
 * under the job's 350-minute timeout) the run goes ahead WITH a warning rather
 * than dying red with its check untested: the exclusion is lost for that one run,
 * the check is not. An API that stays unreadable for ten tries does the same.
 *
 * The queued-workflow inventory is DERIVED from the checked-out workflow files
 * (every file that runs this script), so a new queued workflow is in the queue
 * the day it lands (src/test/prodLoadQueue.test.ts).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rateLimitWaitMs, STALE_RUN_MS } from "../e2e/wait-shared-accounts.mjs";

export { rateLimitWaitMs, STALE_RUN_MS };

/** The line every queued workflow's `prod-load-turn` job runs. */
export const WAITER_COMMAND = "node scripts/ci/wait-prod-load.mjs";
/** Wait at most this long, then run anyway (the job's own timeout is 350 min; GitHub's hard limit is 360). */
export const WAIT_BUDGET_MS = 340 * 60_000;
export const budgetSpent = (startedAt, now = Date.now()) => now - startedAt >= WAIT_BUDGET_MS;
const IN_FLIGHT = ["requested", "queued", "pending", "waiting", "in_progress"];

/** Workflow paths (".github/workflows/x.yml") that run the waiter: the queue's members. */
export function queuedWorkflows(dir = join(process.cwd(), ".github", "workflows")) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) =>
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .some((l) => !/^\s*#/.test(l) && l.includes(WAITER_COMMAND)),
    )
    .sort()
    .map((f) => `.github/workflows/${f}`);
}

const older = (a, b) => (a.created_at === b.created_at ? a.id < b.id : a.created_at < b.created_at);

/**
 * The pure decision. `me` = { id, created_at }; `runs` = scheduled runs of
 * queued workflows that are in flight, each { id, created_at, name, html_url }.
 * Returns { go, why }.
 */
export function decide(me, runs) {
  const ahead = runs
    .filter((r) => r.id !== me.id && older(r, me) && Date.parse(me.created_at) - Date.parse(r.created_at) <= STALE_RUN_MS)
    .sort((a, b) => (older(a, b) ? -1 : 1));
  if (ahead.length === 0) return { go: true, why: "no older scheduled prod-load run is in flight" };
  const first = ahead[0];
  return { go: false, why: `${ahead.length} older scheduled run(s) ahead (first in, first served); the oldest is ${first.name} ${first.html_url}` };
}

// `fetch` is read at call time (not captured) so src/test/prodLoadQueue.test.ts can stub it.
const RL_HEADERS = ["retry-after", "x-ratelimit-reset", "x-ratelimit-remaining", "x-ratelimit-resource"];

async function gh(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const headers = Object.fromEntries(RL_HEADERS.map((h) => [h, r.headers.get(h)]));
    const err = new Error(`HTTP ${r.status} ${path}: ${body.slice(0, 200)} (x-ratelimit remaining=${headers["x-ratelimit-remaining"]})`);
    err.waitMs = rateLimitWaitMs({ status: r.status, headers, body });
    throw err;
  }
  return r.json();
}

/** Every in-flight SCHEDULED run of a queued workflow, newest page first (100 per status). */
export async function snapshot(repo, token, members) {
  const byId = new Map();
  for (const status of IN_FLIGHT) {
    const { workflow_runs: rs = [] } = await gh(`/repos/${repo}/actions/runs?event=schedule&status=${status}&per_page=100`, token);
    for (const r of rs) if (members.has(String(r.path ?? "").split("@")[0])) byId.set(r.id, { id: r.id, created_at: r.created_at, name: r.name, html_url: r.html_url });
  }
  return [...byId.values()];
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const pollMs = Number(process.env.WAIT_POLL_SECONDS ?? 120) * 1000;
  const members = new Set(queuedWorkflows());
  console.log(`Queued workflows (${members.size}): ${[...members].map((p) => p.split("/").pop()).join(", ")}`);
  if (process.env.GITHUB_EVENT_NAME !== "schedule" && !process.argv.includes("--dry-run")) {
    console.log(`Not a scheduled run (event ${process.env.GITHUB_EVENT_NAME ?? "unset"}): a dispatch neither queues nor blocks.`);
    return;
  }
  if (process.argv.includes("--dry-run") && repo && token) {
    // What would a scheduled run created NOW be told? (GITHUB_REPOSITORY=... GITHUB_TOKEN=$(gh auth token))
    const runs = await snapshot(repo, token, members);
    for (const r of runs) console.log(`  in flight: ${r.name} ${r.id} ${r.created_at}`);
    const d = decide({ id: Number.MAX_SAFE_INTEGER, created_at: new Date().toISOString() }, runs);
    console.log(`${d.go ? "GO" : "wait"}: ${d.why}`);
    return;
  }
  if (!repo || !token || !runId) {
    console.log("::warning title=Prod-load queue not checked::GITHUB_REPOSITORY/GITHUB_TOKEN/GITHUB_RUN_ID unset; running without the queue.");
    return;
  }
  let me;
  try {
    const run = await gh(`/repos/${repo}/actions/runs/${runId}`, token);
    me = { id: runId, created_at: run.created_at };
  } catch (e) {
    console.log(`::warning title=Prod-load queue unreadable::${e instanceof Error ? e.message : e}; running without the queue.`);
    return;
  }
  let failures = 0;
  let last = "";
  const startedAt = Date.now();
  for (;;) {
    if (budgetSpent(startedAt)) {
      console.log(`::warning title=Prod-load queue budget spent::waited ${Math.round(WAIT_BUDGET_MS / 60_000)} min behind older scheduled runs (${last || "unknown"}); running now beside them so the check is not lost.`);
      return;
    }
    try {
      const d = decide(me, await snapshot(repo, token, members));
      failures = 0;
      if (d.why !== last) console.log(`${new Date().toISOString()} ${d.go ? "GO" : "wait"}: ${d.why}`);
      last = d.why;
      if (d.go) return;
    } catch (e) {
      if (e?.waitMs != null) {
        // Rate limited: not a broken queue. Sleep to the reset; the job's own timeout still bounds the wait.
        console.log(`::warning::queue check rate-limited, waiting ${Math.round(e.waitMs / 1000)}s: ${e.message}`);
        await new Promise((res) => setTimeout(res, e.waitMs));
        continue;
      }
      failures += 1;
      console.log(`::warning::queue check failed (${failures}/10): ${e instanceof Error ? e.message : e}`);
      if (failures >= 10) {
        console.log("::warning title=Prod-load queue unreadable::running without the queue check for this run.");
        return;
      }
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
