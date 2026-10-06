#!/usr/bin/env node
/**
 * The land queue (owner, 2026-10-05: "make it a queue so if it fails the others
 * will be fixed before their run"). GitHub's own merge queue needs an
 * organization-owned repo and this one is a personal account's, so this is ours.
 *
 * PRs join by the `land-queue` label (scripts/land.sh adds it), oldest PR first.
 * Only the HEAD of the queue is ever brought up to date with main, so a merge
 * re-runs ONE PR's checks, not every open PR's (strict up-to-date is on in the
 * "main" ruleset, so before this every merge sent every other PR back for a
 * rebase and a full re-run). A head whose required check fails leaves the queue
 * (label `land-queue-failed`, a comment naming the checks) and the next PR
 * moves up. A head that conflicts with main (DIRTY) is passed over: land.sh,
 * still waiting on it, rebases it locally and it rejoins.
 *
 *   node scripts/land-queue.mjs            # act (GH_TOKEN; .github/workflows/land-queue.yml)
 *   node scripts/land-queue.mjs --dry-run  # print the decision only
 *
 * Guard: src/test/landQueue.test.ts.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const QUEUE_LABEL = "land-queue";
export const FAILED_LABEL = "land-queue-failed";

/**
 * Pure decision. `prs` are the queued PRs, oldest first:
 * { number, mergeStateStatus, checks: [{ name, bucket, runId, attempt }] }
 * where checks are the REQUIRED ones only and bucket is gh's
 * pass | fail | pending | skipping | cancel.
 * Returns the steps to take, in order; at most one PR is updated, merged or
 * waited on (the head), every failed PR ahead of it is dropped.
 */
export function planQueue(prs) {
  const steps = [];
  for (const pr of prs) {
    const failed = pr.checks.filter((c) => c.bucket === "fail");
    const cancelled = pr.checks.filter((c) => c.bucket === "cancel");
    if (failed.length) {
      steps.push({ action: "fail", number: pr.number, checks: [...new Set(failed.map((c) => c.name))] });
      continue;
    }
    // A cancelled required check is re-run once (runner loss, a superseded
    // run); cancelled again, it fails like any red.
    if (cancelled.length) {
      const again = cancelled.filter((c) => (c.attempt ?? 1) > 1);
      if (again.length) {
        steps.push({ action: "fail", number: pr.number, checks: [...new Set(again.map((c) => c.name))] });
        continue;
      }
      steps.push({ action: "rerun", number: pr.number, runIds: [...new Set(cancelled.map((c) => c.runId).filter(Boolean))] });
      return steps;
    }
    if (pr.mergeStateStatus === "DIRTY") {
      steps.push({ action: "skip", number: pr.number, reason: "conflicts with main; land.sh rebases it" });
      continue;
    }
    if (pr.mergeStateStatus === "BEHIND") {
      steps.push({ action: "update", number: pr.number });
      return steps;
    }
    if (pr.checks.some((c) => c.bucket === "pending") || pr.checks.length === 0) {
      steps.push({ action: "wait", number: pr.number });
      return steps;
    }
    if (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "UNSTABLE" || pr.mergeStateStatus === "HAS_HOOKS") {
      steps.push({ action: "merge", number: pr.number });
      return steps;
    }
    // BLOCKED with every required check green (a review, a ruleset rule):
    // nothing the queue can do; it holds the line rather than skip ahead.
    steps.push({ action: "wait", number: pr.number, reason: pr.mergeStateStatus });
    return steps;
  }
  if (!steps.length) steps.push({ action: "idle" });
  return steps;
}

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function runIdFrom(link) {
  const m = /\/actions\/runs\/(\d+)/.exec(link ?? "");
  return m ? m[1] : null;
}

function readQueue() {
  const list = JSON.parse(gh(["pr", "list", "--state", "open", "--label", QUEUE_LABEL, "--json", "number,isDraft", "--limit", "50"]));
  const prs = [];
  for (const { number } of list.filter((p) => !p.isDraft).sort((a, b) => a.number - b.number)) {
    const view = JSON.parse(gh(["pr", "view", String(number), "--json", "mergeStateStatus"]));
    let checks = [];
    try {
      checks = JSON.parse(gh(["pr", "checks", String(number), "--required", "--json", "name,bucket,link"]));
    } catch (e) {
      // gh exits non-zero while checks are pending or one has failed, and
      // still prints the JSON; only a missing body is a real read failure.
      const out = e && typeof e === "object" && "stdout" in e ? String(e.stdout) : "";
      if (!out.trim()) throw e;
      checks = JSON.parse(out);
    }
    const withRuns = checks.map((c) => {
      const runId = runIdFrom(c.link);
      let attempt = 1;
      if (c.bucket === "cancel" && runId) {
        attempt = Number(gh(["api", `repos/{owner}/{repo}/actions/runs/${runId}`, "--jq", ".run_attempt"]).trim()) || 1;
      }
      return { name: c.name, bucket: c.bucket, runId, attempt };
    });
    prs.push({ number, mergeStateStatus: view.mergeStateStatus, checks: withRuns });
  }
  return prs;
}

function act(step) {
  const n = String(step.number);
  switch (step.action) {
    case "fail":
      gh(["pr", "edit", n, "--remove-label", QUEUE_LABEL, "--add-label", FAILED_LABEL]);
      gh(["pr", "comment", n, "--body", `Left the land queue: required check(s) failed: ${step.checks.join(", ")}. Fix, push, and re-run \`bash scripts/land.sh\` (it re-queues the PR). The next PR in the queue has moved up.`]);
      return;
    case "rerun":
      for (const id of step.runIds) gh(["run", "rerun", id, "--failed"]);
      return;
    case "update":
      gh(["pr", "update-branch", n, "--rebase"]);
      return;
    case "merge":
      gh(["pr", "merge", n, "--rebase"]);
      return;
    default:
      return;
  }
}

function describe(step) {
  const why = step.checks ? `: ${step.checks.join(", ")}` : step.reason ? ` (${step.reason})` : step.runIds ? `: runs ${step.runIds.join(", ")}` : "";
  return step.action === "idle" ? "queue empty" : `#${step.number} ${step.action}${why}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dry = process.argv.includes("--dry-run");
  const prs = readQueue();
  const steps = planQueue(prs);
  const lines = [
    `land-queue: ${prs.length} queued (${prs.map((p) => `#${p.number} ${p.mergeStateStatus}`).join(", ") || "none"})`,
    ...steps.map((s) => `  ${describe(s)}${dry ? " (dry run)" : ""}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (!dry) for (const s of steps) act(s);
}
