/**
 * A SCHEDULED prod-load RUN THAT WAS CANCELLED IS A RED (docs/OPEN.md Q293).
 *
 * Every prod-hitting workflow shares the workflow-level concurrency group
 * `prod-load` (src/test/prodWorkflowSpacing.test.ts). GitHub keeps ONE pending
 * run per group: a third run entering it cancels the one already waiting, at
 * WORKFLOW level, so not one job runs — not even the `notify` job that files
 * the nightly-red issue. The run's only trace is conclusion `cancelled` in the
 * run list. For the monthly privacy journey that is a missed month, and
 * schedule-heartbeat's staleness rule cannot see it (the cancelled run still
 * counts as "a scheduled run", created on time).
 *
 * So: for every workflow whose concurrency group can be `prod-load` (derived
 * from the files, never a hand list), list its recent schedule-triggered runs
 * and report every one whose conclusion is `cancelled` inside WINDOW_DAYS.
 * schedule-heartbeat.yml runs this daily and counts each as stalled, which
 * opens the `schedule-stalled` issue and turns the heartbeat red.
 *
 *   node scripts/ci/cancelled-prod-load-runs.mjs   (needs gh + GH_TOKEN, REPO)
 *
 * Prints one markdown table row per cancelled run, then `cancelled=<n>` last.
 * Exit 2 when a workflow's runs could not be read: not checked is not clean.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Eight days: a weekly cadence plus one, so every cancelled run is reported by at least one daily heartbeat and stays red for a week. */
export const WINDOW_DAYS = 8;

/** The workflow-level `concurrency.group` of a workflow file, or null. Top-level only (a job's own group is not the account lock). */
export function workflowConcurrencyGroup(src) {
  const m = /^concurrency:\s*\n((?:[ \t]+.*\n|[ \t]*\n)*)/m.exec(src.endsWith("\n") ? src : `${src}\n`);
  if (!m) {
    const inline = /^concurrency:\s*(\S.*)$/m.exec(src);
    return inline ? inline[1].trim().replace(/^["']|["']$/g, "") : null;
  }
  const g = /^[ \t]+group:\s*(.+)$/m.exec(m[1]);
  return g ? g[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Can this group be `prod-load`? A literal, or an expression that yields 'prod-load' on some event. */
export function isProdLoadGroup(group) {
  if (!group) return false;
  return group === "prod-load" || /'prod-load'/.test(group);
}

/** Every workflow file whose scheduled runs share the prod-load group. */
export function prodLoadWorkflows(dir = resolve(process.cwd(), ".github/workflows")) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      const src = readFileSync(resolve(dir, f), "utf8");
      return /^\s*schedule:\s*$/m.test(src) && isProdLoadGroup(workflowConcurrencyGroup(src));
    })
    .sort();
}

/** The runs (GitHub API shape) that were cancelled inside the window. */
export function cancelledScheduledRuns(runs, { now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  const since = now - windowDays * 86_400_000;
  return runs.filter((r) => r.event === "schedule" && r.status === "completed" && r.conclusion === "cancelled" && Date.parse(r.created_at) >= since);
}

function main() {
  const repo = process.env.REPO;
  if (!repo) { console.error("REPO is not set"); process.exit(2); }
  const files = prodLoadWorkflows();
  if (files.length < 5) { console.error(`found only ${files.length} prod-load workflows — the scan is broken`); process.exit(2); }
  let n = 0;
  let unread = 0;
  for (const f of files) {
    let runs;
    try {
      runs = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/actions/workflows/${f}/runs?event=schedule&per_page=20`, "--jq", ".workflow_runs"], { encoding: "utf8" }));
    } catch (e) {
      unread++;
      console.error(`::error::${f}: could not list scheduled runs (${String(e.message).split("\n")[0]})`);
      continue;
    }
    for (const r of cancelledScheduledRuns(runs)) {
      n++;
      console.log(`| \`${f}\` | cancelled | ${r.created_at} | 🔴 scheduled run cancelled, nothing reported: ${r.html_url} |`);
      console.error(`::error::${f}: scheduled run ${r.id} (${r.created_at}) was cancelled; no job ran, so no nightly-red issue was filed (Q293).`);
    }
  }
  console.log(`cancelled=${n}`);
  if (unread) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
