/**
 * THIS RUN'S OWN JOBS — what lets a teardown sweep settle the rows a CANCELLED
 * run left, instead of deferring them until some later run happens to sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * prod-lifecycle-sweeper.mjs never settles a hired+funded row younger than
 * SETTLE_FORWARD_MIN_AGE_MS (6 h): such a row "may be a live run's job". That
 * bound is right for a row it knows nothing about. It is wrong for the rows the
 * run doing the sweep created itself. By the time its teardown step runs, that
 * run's Playwright step has ended (passed, failed or killed by a cancel), and
 * the run still holds the shared-accounts concurrency group, so no other run is
 * driving those rows.
 *
 * Measured 2026-11-04 (Builder 2, read-only SQL + run logs): three
 * "[E2E DO NOT ACCEPT]" jobs sat on the shared 0902 seats in escrow for more
 * than a day. d62ad01c ("J 144yjt", revision_requested) came from e2e-journeys
 * 41700760650, 9ce18a98 ("J 1brr70", in_progress) from 41737043318 and
 * 3801d1da ("J 1c1qba", accepted -> in_progress) from 41741012840. All three
 * runs were CANCELLED in the middle of 02-marketplace's chain, so its afterAll
 * never settled its own job. Each run's teardown sweep logged "too young to
 * settle forward ... may be a live run's job" for the row it had made itself
 * (it was 30-40 min old), and no sweep with both seats ran for the next 24 h.
 * Every journey that creates a job now records the id here (fixtures.ts
 * recordOwnRunJob). The TEARDOWN sweep of the same workflow job reads the file
 * and walks those rows forward whatever their age. A pre sweep never does:
 * nothing it reads was made by its own run.
 *
 * WHAT IT DOES NOT CHANGE
 * -----------------------
 * Only the age gate. Every refusal in settleRefusalReason still applies to a
 * recorded id: is_seed only, the calling seats only, no dispute, cs_test_ only,
 * escrow only. A recorded id this sweep did not list (another poster's job, a
 * settled row) is never touched, because the list query decides what is swept
 * and this file only lifts the wait.
 *
 * The file path comes from SWEEP_OWN_JOB_IDS_FILE (set at job level in
 * e2e-journeys.yml, relative to the workspace both steps run in). When it is
 * unset (a local run, any other workflow) recording is a no-op and the sweep
 * keeps the 6 h rule unchanged.
 *
 * Guard: src/test/sweepSettlesOwnRunJobs.test.ts.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const OWN_RUN_JOBS_ENV = "SWEEP_OWN_JOB_IDS_FILE";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Append one job id to this run's list. A no-op when the env var is unset or
 * the id is not a uuid. Called the moment a journey learns its job's id, so a
 * cancel that kills the test a second later still leaves the id on disk.
 * @param {string} jobId
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean} whether it was written
 */
export function recordOwnRunJob(jobId, env = process.env) {
  const path = env[OWN_RUN_JOBS_ENV];
  if (!path || typeof jobId !== "string" || !UUID.test(jobId)) return false;
  appendFileSync(path, `${jobId.toLowerCase()}\n`);
  return true;
}

/**
 * Every id this run recorded. Missing file or unset env: an empty set.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Set<string>}
 */
export function readOwnRunJobIds(env = process.env) {
  const path = env[OWN_RUN_JOBS_ENV];
  if (!path || !existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => UUID.test(l)),
  );
}

/**
 * May the sweep walk this hired+funded row forward NOW?
 * Old enough for anyone: yes. Younger: only in a teardown, and only a row this
 * same run recorded as its own.
 * @param {{ id: string, ageMs: number, minAgeMs: number, phase: string, ownIds: Set<string> }} input
 * @returns {boolean}
 */
export function mayWalkForward({ id, ageMs, minAgeMs, phase, ownIds }) {
  if (Number.isFinite(ageMs) && ageMs >= minAgeMs) return true;
  return phase === "teardown" && ownIds.has(String(id).toLowerCase());
}
