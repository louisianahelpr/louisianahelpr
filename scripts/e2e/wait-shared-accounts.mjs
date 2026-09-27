#!/usr/bin/env node
/**
 * A QUEUE in front of the shared-accounts lock (docs/OPEN.md Q743).
 *
 * Every job that drives the shared prod test accounts holds the job-level
 * concurrency group `prod-lifecycle-shared-accounts` (Q326). GitHub keeps ONE
 * pending job per group: when a third job enters, the one already waiting is
 * CANCELLED ("Canceling since a higher priority waiting request for
 * prod-lifecycle-shared-accounts exists"). A group alone is therefore not a
 * queue. Measured victims: e2e-journeys 36215839785, 36215921402 and
 * 36217255758 (2026-09-26, a ~25-dispatch storm); press-every-control
 * 36297157445, cancelled at 05:26:28Z on 2026-09-27 two seconds after
 * loading-states-refresh 36297208529 was dispatched behind a running
 * prod-audit.
 *
 * So each locked job `needs:` a lock-free job that runs this script first. It
 * polls the Actions API and returns only when entering the group can bump
 * nobody:
 *   1. no locked job anywhere is waiting for the group (the one pending slot
 *      is free), and
 *   2. no OLDER in-flight run (created_at, then id) is still on its way to the
 *      group: it has jobs but none of its locked jobs has started, or it is
 *      between two locked legs (e2e-journeys chromium -> webkit). Older goes
 *      first: that is the FIFO.
 * The group stays as the mutual exclusion; this only decides WHEN to join it.
 * A run parked at WORKFLOW level (no jobs yet) is not in this queue and is not
 * waited for, so two prod-load runs can never deadlock on each other.
 *
 * On the job's timeout it fails loudly naming the holder: a red that says
 * "accounts busy" instead of a silent cancel. An unreadable API is retried; if
 * it stays unreadable the job proceeds with a warning (the group still
 * serialises; the worst case is the old behaviour, never a deadlock).
 *
 * The locked-job inventory is DERIVED from the checked-out workflow files, so a
 * new locked job is in the queue the day it lands
 * (src/test/sharedAccountLockQueues.test.ts).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LOCK = "prod-lifecycle-shared-accounts";
const IN_FLIGHT = ["requested", "queued", "pending", "waiting", "in_progress"];
const DRIVES_ACCOUNTS = new Set(["schedule", "workflow_dispatch"]);
const WAITING = new Set(["queued", "pending", "waiting", "requested"]);

/**
 * Every job holding the lock, per workflow path: `{ ".github/workflows/x.yml": [{ key, name }] }`.
 * A dependency-free line parser (the waiter runs before `npm ci`); the guard test
 * checks it against a real YAML parse.
 */
export function lockedJobs(dir = join(process.cwd(), ".github", "workflows")) {
  const out = {};
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const lines = readFileSync(join(dir, file), "utf8")
      .split("\n")
      .map((l) => l.replace(/(^|\s)#.*$/, ""));
    let inJobs = false;
    let cur = null;
    let inConc = false;
    const jobs = [];
    const flush = () => {
      if (cur?.locked) jobs.push({ key: cur.key, name: cur.name ?? cur.key });
    };
    for (const l of lines) {
      if (/^\S/.test(l)) {
        if (inJobs) flush();
        cur = null;
        inJobs = /^jobs:\s*$/.test(l);
        continue;
      }
      if (!inJobs) continue;
      const k = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
      if (k) {
        flush();
        cur = { key: k[1], name: undefined, locked: false };
        inConc = false;
        continue;
      }
      if (!cur) continue;
      const n = /^ {4}name:\s*(.+?)\s*$/.exec(l);
      if (n) cur.name = n[1].replace(/^(["'])(.*)\1$/, "$2");
      if (/^ {4}\S/.test(l)) inConc = /^ {4}concurrency:\s*$/.test(l);
      if (/^ {4}concurrency:\s*prod-lifecycle-shared-accounts\s*$/.test(l)) cur.locked = true;
      if (inConc && /^ {6}group:\s*["']?prod-lifecycle-shared-accounts["']?\s*$/.test(l)) cur.locked = true;
    }
    if (inJobs) flush();
    if (jobs.length) out[`.github/workflows/${file}`] = jobs;
  }
  return out;
}

/** Does an API job (display name, matrix suffix included) belong to a locked job? */
export function matchesLocked(apiName, locked) {
  return locked.some(({ name }) => {
    const i = name.indexOf("${{");
    return i === -1 ? apiName === name : apiName.startsWith(name.slice(0, i));
  });
}

const older = (a, b) => (a.created_at === b.created_at ? a.id < b.id : a.created_at < b.created_at);

/**
 * The pure decision. `me` = { id, created_at }; `runs` = other in-flight runs of
 * locked workflows, each { id, created_at, name, path, html_url, jobs: [{ name, status }] }.
 * Returns { go: boolean, why: string }.
 */
export function decide(me, runs, inventory) {
  for (const run of runs) {
    if (run.id === me.id) continue;
    const locked = inventory[run.path] ?? [];
    const lockJobs = run.jobs.filter((j) => matchesLocked(j.name, locked));
    const waiting = lockJobs.find((j) => WAITING.has(j.status));
    if (waiting) return { go: false, why: `${run.name} ${run.html_url} is waiting for the lock ("${waiting.name}")` };
  }
  for (const run of runs) {
    if (run.id === me.id || !older(run, me) || run.jobs.length === 0) continue;
    const locked = inventory[run.path] ?? [];
    const lockJobs = run.jobs.filter((j) => matchesLocked(j.name, locked));
    const holding = lockJobs.some((j) => j.status === "in_progress");
    const started = lockJobs.filter((j) => j.status === "completed" && j.conclusion !== "skipped");
    if (holding) continue;
    if (lockJobs.length === 0 || started.length === 0) {
      if (lockJobs.length > 0 && lockJobs.every((j) => j.status === "completed")) continue; // all skipped
      return { go: false, why: `older run ${run.name} ${run.html_url} has not reached the lock yet (first in, first served)` };
    }
    if (lockJobs.length < locked.length) {
      return { go: false, why: `older run ${run.name} ${run.html_url} is between two locked legs` };
    }
  }
  return { go: true, why: "no job waiting for the lock and no older run ahead" };
}

async function gh(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

async function snapshot(repo, token, inventory) {
  const byId = new Map();
  for (const status of IN_FLIGHT) {
    const { workflow_runs: rs = [] } = await gh(`/repos/${repo}/actions/runs?status=${status}&per_page=100`, token);
    // Only scheduled and dispatched runs reach a locked job: every locked job is
    // gated off push/PR (the push legs of e2e-real-backend never sign in).
    for (const r of rs) if (inventory[r.path?.split("@")[0]] && DRIVES_ACCOUNTS.has(r.event)) byId.set(r.id, r);
  }
  const runs = [];
  for (const r of byId.values()) {
    const { jobs = [] } = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, token);
    runs.push({
      id: r.id,
      created_at: r.created_at,
      name: r.name,
      path: r.path.split("@")[0],
      html_url: r.html_url,
      jobs: jobs.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion })),
    });
  }
  return runs;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const pollMs = Number(process.env.WAIT_POLL_SECONDS ?? 60) * 1000;
  const inventory = lockedJobs();
  console.log(`Locked jobs (${LOCK}):`);
  for (const [p, js] of Object.entries(inventory)) console.log(`  ${p}: ${js.map((j) => j.key).join(", ")}`);
  if (process.argv.includes("--dry-run") && repo && token) {
    // What would a run created NOW be told? (local check: GITHUB_REPOSITORY=... GITHUB_TOKEN=$(gh auth token))
    const runs = await snapshot(repo, token, inventory);
    for (const r of runs) console.log(`  in flight: ${r.name} ${r.id} ${r.created_at} ${r.jobs.map((j) => `${j.name}=${j.status}`).join("; ")}`);
    const d = decide({ id: Number.MAX_SAFE_INTEGER, created_at: new Date().toISOString() }, runs, inventory);
    console.log(`${d.go ? "GO" : "wait"}: ${d.why}`);
    return;
  }
  if (!repo || !token || !runId) {
    console.log("::warning title=Shared-accounts queue not checked::GITHUB_REPOSITORY/GITHUB_TOKEN/GITHUB_RUN_ID unset; joining the lock directly.");
    return;
  }
  let meRun;
  try {
    meRun = await gh(`/repos/${repo}/actions/runs/${runId}`, token);
  } catch (e) {
    console.log(`::warning title=Shared-accounts queue unreadable::${e instanceof Error ? e.message : e}; joining the lock without the queue check.`);
    return;
  }
  const me = { id: runId, created_at: meRun.created_at };
  let failures = 0;
  let last = "";
  for (;;) {
    try {
      const d = decide(me, await snapshot(repo, token, inventory), inventory);
      failures = 0;
      if (d.why !== last) console.log(`${new Date().toISOString()} ${d.go ? "GO" : "wait"}: ${d.why}`);
      last = d.why;
      if (d.go) return;
    } catch (e) {
      failures += 1;
      console.log(`::warning::queue check failed (${failures}/10): ${e instanceof Error ? e.message : e}`);
      if (failures >= 10) {
        console.log("::warning title=Shared-accounts queue unreadable::joining the lock without the queue check; the group still serialises.");
        return;
      }
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
