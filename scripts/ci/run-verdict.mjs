#!/usr/bin/env node
/**
 * WAS THIS RED RUN A FAILURE, OR ONLY CANCELLED JOBS? (owner, 2026-10-05)
 *
 * On 2026-10-05 five of the nine open `nightly-red` issues came from runs whose
 * jobs were CANCELLED, not failed: db-drift-detect run 37373724889 attempt 1
 * ("Wait for the prod-load queue" -> annotation "The job was not acquired by
 * Runner of type hosted even after multiple attempts"), and the notify job
 * still ran (`!cancelled()` is true when only a JOB was cancelled, not the run)
 * and filed `status: failure`, because its status expression is positive
 * (nightlyIssueSyncIsFailClosed: anything but success is a red).
 *
 * .github/actions/nightly-issue-sync asks this script before it files a red.
 * It reads the jobs of the run's CURRENT attempt and classifies them:
 *
 *   failure    any job concluded failure / timed_out / startup_failure /
 *              action_required / stale, OR a `cancelled` job that was really a
 *              timeout or a failed step (see below), OR no job was cancelled
 *              at all (a red the caller computed from skipped jobs stays red);
 *   cancelled  at least one job was cancelled and every other non-success job
 *              is cancelled too (skipped / neutral / still running are ignored:
 *              the reporting job itself is in progress while it asks).
 *
 * A TIMEOUT LOOKS LIKE A CANCEL (measured 2026-10-05): a11y-webkit-prod run
 * 37355527038, job "Sweep prod (chromium + webkit)", has job conclusion
 * `cancelled` in the jobs API, its check-run annotation reads "The job has
 * exceeded the maximum execution time of 1h0m0s", and one of its steps
 * concluded `failure` ("Process completed with exit code 1"). So a cancelled
 * job counts as a FAILURE when an annotation says it exceeded its maximum
 * execution time, or when any of its steps concluded `failure`. Only a cancel
 * with neither is an infrastructure cancel.
 *
 * Fail-closed: when the run, its jobs or an annotation cannot be read, the
 * verdict is `failure` and the red is filed exactly as before.
 *
 *   node scripts/ci/run-verdict.mjs <run-url-or-id> [attempt]    (needs gh + GH_TOKEN, REPO;
 *   the attempt defaults to the run's current one, which is what the sync uses)
 *   prints {"verdict":"failure"|"cancelled","attempt":N,"runId":"...","cancelled":[...],"failed":[...],"reason":"..."}
 *
 * Guard: src/test/nightlyCancelledJobsAreRerunNotFiled.test.ts.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Job conclusions that are a real red on their own. */
export const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required", "stale"]);

/** Annotation text GitHub writes on a job killed by its own timeout-minutes. */
export const TIMEOUT_ANNOTATION = /exceeded the maximum execution time/i;

/** The run id inside a run URL (…/actions/runs/<id>[/attempts/<n>]), or a bare id. */
export function runIdOf(urlOrId) {
  const s = String(urlOrId ?? "").trim();
  if (/^\d+$/.test(s)) return s;
  return /\/actions\/runs\/(\d+)/.exec(s)?.[1] ?? null;
}

/**
 * jobs: [{ id, name, status, conclusion, steps?: [{ conclusion }] }]
 * annotations: { [jobId]: [{ message }] } for the cancelled jobs (missing = unread).
 */
export function classifyJobs(jobs, annotations = {}) {
  const cancelled = [], failed = [];
  for (const j of jobs ?? []) {
    if (j.status && j.status !== "completed") continue;
    const c = j.conclusion ?? "";
    if (FAILED_CONCLUSIONS.has(c)) { failed.push(`${j.name} (${c})`); continue; }
    if (c !== "cancelled") continue;
    const notes = annotations[j.id];
    if (!Array.isArray(notes)) { failed.push(`${j.name} (cancelled; annotations unread)`); continue; }
    if (notes.some((a) => TIMEOUT_ANNOTATION.test(a?.message ?? ""))) { failed.push(`${j.name} (timed out)`); continue; }
    if ((j.steps ?? []).some((s) => s?.conclusion === "failure")) { failed.push(`${j.name} (cancelled after a failed step)`); continue; }
    cancelled.push(j.name);
  }
  if (failed.length) return { verdict: "failure", cancelled, failed, reason: "a job failed or timed out" };
  if (!cancelled.length) return { verdict: "failure", cancelled, failed, reason: "no cancelled job: the caller's red stands" };
  return { verdict: "cancelled", cancelled, failed, reason: "every non-success job was cancelled" };
}

function ghJson(path) {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

/** Reads the run's current attempt, its jobs and the cancelled jobs' annotations. Never throws. */
export function verdictForRun(urlOrId, repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY, onlyAttempt = undefined) {
  const runId = runIdOf(urlOrId);
  if (!runId || !repo) return { verdict: "failure", attempt: 0, runId, cancelled: [], failed: [], reason: "no run id or repo" };
  try {
    const run = ghJson(`repos/${repo}/actions/runs/${runId}`);
    const attempt = onlyAttempt ? Number(onlyAttempt) : Number(run.run_attempt ?? 0);
    const jobs = ghJson(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`).jobs ?? [];
    const annotations = {};
    for (const j of jobs.filter((x) => x.conclusion === "cancelled")) {
      try { annotations[j.id] = ghJson(`repos/${repo}/check-runs/${j.id}/annotations`); }
      catch { /* left unread: classifyJobs counts the job as a failure (fail-closed) */ }
    }
    return { ...classifyJobs(jobs, annotations), attempt, runId };
  } catch (e) {
    return { verdict: "failure", attempt: 0, runId, cancelled: [], failed: [], reason: `run unreadable: ${(e instanceof Error ? e.message : "unknown error").split("\n")[0]}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verdictForRun(process.argv[2], undefined, process.argv[3])));
}
