/**
 * CLASS GUARD (docs/OPEN.md Q326): every job that drives the shared prod test
 * accounts holds the SAME lock, on every trigger: the job-level concurrency
 * group `prod-lifecycle-shared-accounts`, with cancel-in-progress false.
 *
 * Found by the Q280 agent (2026-09-23): e2e-journeys' dispatch runs in its own
 * workflow group and its jobs hold `prod-lifecycle-shared-accounts`, while
 * press-every-control held only the workflow-level `prod-load`. Two different
 * locks on one resource are no lock: a dispatched journey and a press run
 * drove the same poster/helper at once, each mutating state the other
 * asserts. The press job now holds the account lock itself (its shards run in
 * waves inside it, scripts/audit/press-wave.sh).
 *
 * A job lock holds on EVERY trigger (a workflow-level group can differ by
 * event; a job's literal group cannot), so "on every trigger" is checked by
 * requiring the literal group.
 *
 * Inventory from source: every job whose env (workflow, job or step level)
 * names a shared-account secret (PLAYWRIGHT_POSTER/HELPER/ADMIN/INCOMPLETE_
 * EMAIL/PASSWORD/SESSION) and that can sign in with it, meaning it runs
 * something beyond `[ -n "$X" ]` presence checks. A preflight that only tests
 * whether the secrets are set signs nothing in.
 *
 * Q550/Q551 (2026-10-04): the two jobs that were NOT_LOCKED for want of a shape
 * now hold it. a11y-webkit-prod's two-engine matrix became ONE `sweep` job that
 * runs chromium then webkit; vacuity.yml's credentialed Playwright registrations
 * moved out of the credential-free `vacuity` job into `vacuity-e2e`, which only
 * exists when `scope` finds one. The matrix rule below keeps the first shape from
 * coming back: a matrix of locked jobs serialises itself, and GitHub's one
 * pending job per group cancels a leg.
 *
 * NOT_LOCKED is exact and two-way: each entry must be a job that signs in and
 * does NOT hold the lock. When one gains it, delete the entry; this test fails
 * until you do.
 */
// @mutate .github/workflows/press-every-control.yml |     timeout-minutes: 57 # press leg 5\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    env:\n      BASE: |     timeout-minutes: 57 # press leg 5\n    env:\n      BASE:
// @mutate .github/workflows/e2e-journeys.yml | needs: [preflight, wait-accounts]\n    if: needs.preflight.outputs.have_accounts == 'true'\n    runs-on: ubuntu-latest\n    # Locked jobs hold the shared accounts <= 60 min (sharedAccountLockJobsAreShort.test.ts).\n    # Measured 2026-09-30: journeys max 30.3 min over 44 runs, journeys-webkit max\n    # 24.3 min among completed runs.\n    timeout-minutes: 60\n    # Workflow-level group is prod-load now; this job-level lock keeps the\n    # shared-account serialisation with e2e-real-backend's push-triggered\n    # prod-lifecycle job, which holds the same group.\n    concurrency:\n      group: prod-lifecycle-shared-accounts | needs: [preflight, wait-accounts]\n    if: needs.preflight.outputs.have_accounts == 'true'\n    runs-on: ubuntu-latest\n    # Locked jobs hold the shared accounts <= 60 min (sharedAccountLockJobsAreShort.test.ts).\n    # Measured 2026-09-30: journeys max 30.3 min over 44 runs, journeys-webkit max\n    # 24.3 min among completed runs.\n    timeout-minutes: 60\n    # Workflow-level group is prod-load now; this job-level lock keeps the\n    # shared-account serialisation with e2e-real-backend's push-triggered\n    # prod-lifecycle job, which holds the same group.\n    concurrency:\n      group: e2e-journeys-own
// @mutate .github/workflows/e2e-real-backend.yml | # holds (docs/OPEN.md Q326; src/test/sharedAccountJobsHoldOneLock.test.ts).\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: "22"\n          cache: "npm"\n      - name: Drop the Google Chrome apt source | # holds (docs/OPEN.md Q326; src/test/sharedAccountJobsHoldOneLock.test.ts).\n    #\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: "22"\n          cache: "npm"\n      - name: Drop the Google Chrome apt source
// @mutate .github/workflows/a11y-webkit-prod.yml |     timeout-minutes: 60\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    env:\n      PLAYWRIGHT_BASE_URL |     timeout-minutes: 60\n    env:\n      PLAYWRIGHT_BASE_URL
// @mutate .github/workflows/a11y-webkit-prod.yml |     timeout-minutes: 60\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    env:\n      PLAYWRIGHT_BASE_URL |     timeout-minutes: 60\n    strategy:\n      matrix:\n        engine: [chromium, webkit]\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    env:\n      PLAYWRIGHT_BASE_URL
// @mutate .github/workflows/vacuity.yml |     timeout-minutes: 57 # e2e leg 3 (Q1270)\n    concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false |     timeout-minutes: 57 # e2e leg 3 (Q1270)
// @mutate .github/workflows/slow-network.yml |       group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false |       group: prod-lifecycle-shared-accounts\n      cancel-in-progress: true
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const WF_DIR = resolve(__dirname, "../../.github/workflows");
export const LOCK = "prod-lifecycle-shared-accounts";
const SHARED_SECRET = /secrets\.PLAYWRIGHT_(POSTER|HELPER|ADMIN|INCOMPLETE)_(EMAIL|PASSWORD|SESSION)\b/;

/** `file:job` → why it does not hold the lock. Exact, two-way. */
export const NOT_LOCKED: Record<string, string> = {
  "core-loop-canary.yml:canary":
    "hourly; queued in the lock it would cancel a pending suite (one pending run per group), so it ASKS " +
    "instead: scripts/canary/shared-accounts-busy.mjs stands it down while any shared-account workflow runs " +
    "(src/test/coreLoopCanary.test.ts).",
};

type Step = { run?: string; uses?: string; env?: Record<string, unknown> };
type Job = {
  concurrency?: string | { group?: string; "cancel-in-progress"?: unknown };
  env?: Record<string, unknown>;
  steps?: Step[];
  strategy?: { matrix?: unknown; "max-parallel"?: unknown };
};
type Wf = { env?: Record<string, unknown>; jobs?: Record<string, Job> };

/** Runs something that can use the credentials: a program, or an action beyond checkout/setup/artifacts. */
const RUNS_A_PROGRAM = /\b(node|npx|npm|curl|bash|playwright|supabase)\b/;
function signsIn(job: Job): boolean {
  return (job.steps ?? []).some(
    (s) =>
      (!!s.uses && !/^actions\/(checkout|setup-node|upload-artifact|download-artifact)@/.test(s.uses)) ||
      RUNS_A_PROGRAM.test(String(s.run ?? "")),
  );
}

export function sharedAccountJobs(dir = WF_DIR) {
  const out: { key: string; job: Job }[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const wf = parse(readFileSync(join(dir, file), "utf8")) as Wf;
    const wfEnv = JSON.stringify(wf.env ?? {});
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      const text = wfEnv + JSON.stringify(job.env ?? {}) + JSON.stringify((job.steps ?? []).map((s) => s.env ?? {}));
      if (SHARED_SECRET.test(text) && signsIn(job)) out.push({ key: `${file}:${name}`, job });
    }
  }
  return out;
}

const lockOf = (job: Job) => {
  const c = job.concurrency;
  return { group: typeof c === "string" ? c : c?.group, cancel: typeof c === "object" ? c?.["cancel-in-progress"] : undefined };
};

const jobs = sharedAccountJobs();

describe("Q326: every job that drives the shared test accounts holds one lock", () => {
  it("finds the shared-account jobs (inventory floor)", () => {
    expect(jobs.length).toBeGreaterThan(8);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(jobs.map((j) => j.key)).toContain(`press-every-control.yml:press-${n}`);
    expect(jobs.map((j) => j.key)).toContain("e2e-journeys.yml:journeys");
    // Q550/Q551: the two jobs that used to be NOT_LOCKED are in the inventory, and locked.
    for (const k of ["a11y-webkit-prod.yml:sweep", "vacuity.yml:vacuity-e2e", "vacuity.yml:vacuity-e2e-2", "vacuity.yml:vacuity-e2e-3", "vacuity.yml:vacuity-e2e-4"]) expect(jobs.map((j) => j.key)).toContain(k);
  });

  it("a presence-only preflight is not counted as signing in", () => {
    const pre = { steps: [{ run: 'if [ -n "$POSTER_EMAIL" ] && [ -n "$POSTER_PASSWORD" ]; then\n  echo "have_accounts=true" >> "$GITHUB_OUTPUT"\nfi' }] };
    expect(signsIn(pre)).toBe(false);
    expect(signsIn({ steps: [{ run: "npx playwright test --project=journeys" }] })).toBe(true);
    expect(signsIn({ steps: [{ uses: "./.github/actions/local-preview" }] })).toBe(true);
  });

  it.each(jobs.filter((j) => !NOT_LOCKED[j.key]).map((j) => [j.key, j.job] as const))(
    "%s holds prod-lifecycle-shared-accounts, cancel-in-progress false",
    (_key, job) => {
      const { group, cancel } = lockOf(job);
      expect(group, "a second lock on the same accounts is no lock (Q326)").toBe(LOCK);
      expect(cancel, "a cancelled run strands fixture rows").toBe(false);
    },
  );

  it("no locked job is a parallel matrix: its legs would queue on one lock and GitHub cancels the pending one (Q550)", () => {
    // max-parallel: 1 starts one leg at a time, so only one is ever queued
    // (e2e-abuse-notifications' two projects); anything wider queues them all.
    const matrixed = jobs
      .filter((j) => j.job.strategy?.matrix !== undefined && lockOf(j.job).group === LOCK && j.job.strategy["max-parallel"] !== 1)
      .map((j) => j.key);
    expect(matrixed, "fold the legs into one locked job, as a11y-webkit-prod's sweep and press-every-control do").toEqual([]);
  });

  it("a job holding the shared-account secrets without the lock is only ever listed, never new (Q551)", () => {
    // vacuity.yml's credential-free `vacuity` job must stay out of the inventory:
    // the day it names a shared-account secret again it must hold the lock.
    expect(jobs.map((j) => j.key)).not.toContain("vacuity.yml:vacuity");
  });

  it("NOT_LOCKED is exact: every entry is a real shared-account job that does not hold the lock", () => {
    const byKey = new Map(jobs.map((j) => [j.key, j.job]));
    for (const key of Object.keys(NOT_LOCKED)) {
      expect(byKey.has(key), `${key} is exempt but is not a shared-account job that signs in`).toBe(true);
      expect(lockOf(byKey.get(key)!).group, `${key} now holds the lock; delete its NOT_LOCKED entry`).not.toBe(LOCK);
    }
  });
});
