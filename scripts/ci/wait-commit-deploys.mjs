#!/usr/bin/env node
/**
 * Wait for THIS commit's prod deploys before prod-backed checks run (Q432).
 *
 * A push that lands a migration and an edge function together starts
 * db-deploy, functions-deploy and vacuity at the same moment. vacuity's
 * Playwright registrations run against prod, so until the deploys finish they
 * test the OLD backend, read RED before any mutation, and are scored
 * inconclusive for a reason the push itself fixes minutes later. Measured on
 * vacuity run 36215687625 (2026-09-26, Q433): both privacy-requests.spec.ts
 * registrations "RED before any mutation" while functions-deploy 36215687560
 * was still deploying.
 *
 * Reads the runs of DEPLOY_WORKFLOWS for GITHUB_SHA. None (the push touched
 * nothing they deploy) -> go at once. Any still in flight -> poll every 20 s.
 * Every one completed -> go; a deploy that FAILED is printed as a warning,
 * because the checks will then test a backend that does not match the
 * commit. After BUDGET_MS the job goes ahead with a warning rather than
 * dying with its check untested. Exit 0 always.
 */
const IN_FLIGHT = new Set(["requested", "queued", "pending", "waiting", "in_progress"]);
export const DEPLOY_WORKFLOWS = ["db-deploy.yml", "functions-deploy.yml"];
export const BUDGET_MS = 25 * 60_000;
const POLL_MS = 20_000;

/**
 * Pure: what the waiter does with this commit's deploy runs.
 * @param {Array<{name?: string, status: string, conclusion?: string|null, html_url?: string}>} runs
 * @returns {{action: "go"|"wait", warn: string[], why: string}}
 */
export function deployWaitDecision(runs) {
  if (!runs.length) return { action: "go", warn: [], why: "no deploy run for this commit" };
  const inFlight = runs.filter((r) => IN_FLIGHT.has(r.status));
  if (inFlight.length) {
    return { action: "wait", warn: [], why: `${inFlight.length} deploy run(s) in flight: ${inFlight.map((r) => r.name ?? r.html_url).join(", ")}` };
  }
  const bad = runs.filter((r) => r.conclusion !== "success" && r.conclusion !== "skipped");
  return {
    action: "go",
    warn: bad.map((r) => `${r.name ?? "deploy"} ended ${r.conclusion}: ${r.html_url ?? ""} (prod may not match this commit)`),
    why: `${runs.length} deploy run(s) done`,
  };
}

async function runsFor(repo, token, sha) {
  const out = [];
  for (const wf of DEPLOY_WORKFLOWS) {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?head_sha=${sha}&per_page=10`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`${wf}: HTTP ${r.status}`);
    out.push(...((await r.json()).workflow_runs ?? []));
  }
  return out;
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, GITHUB_SHA: sha } = process.env;
  if (!repo || !token || !sha) {
    console.log("::warning title=Deploy wait skipped::GITHUB_REPOSITORY/GITHUB_TOKEN/GITHUB_SHA unset; not waiting for this commit's deploys.");
    return;
  }
  const started = Date.now();
  let failures = 0;
  for (;;) {
    let d;
    try {
      d = deployWaitDecision(await runsFor(repo, token, sha));
      failures = 0;
    } catch (e) {
      if (++failures >= 10) {
        console.log(`::warning title=Deploy wait gave up::the runs API failed 10 times (${e instanceof Error ? e.message : e}); going ahead.`);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    if (d.action === "go") {
      for (const w of d.warn) console.log(`::warning title=A deploy for this commit did not succeed::${w}`);
      console.log(`go: ${d.why}`);
      return;
    }
    if (Date.now() - started >= BUDGET_MS) {
      console.log(`::warning title=Deploy wait budget spent::still ${d.why} after ${BUDGET_MS / 60_000} min; going ahead.`);
      return;
    }
    console.log(`wait: ${d.why}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
