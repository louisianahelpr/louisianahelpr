/**
 * CLASS GUARD (docs/OPEN.md Q743): the shared-accounts lock is a QUEUE, not a
 * last-one-wins slot.
 *
 * Every job driving the shared prod test accounts holds the job-level group
 * `prod-lifecycle-shared-accounts` (Q326, sharedAccountJobsHoldOneLock.test.ts).
 * GitHub keeps ONE pending job per concurrency group and cancels it when a third
 * arrives, so a group alone silently drops runs: e2e-journeys 36215839785,
 * 36215921402 and 36217255758 (2026-09-26) and press-every-control 36297157445
 * (2026-09-27 05:26:28Z, two seconds after loading-states-refresh 36297208529
 * queued behind prod-audit 36290267474). A cancelled run is a hidden red.
 *
 * The fix: every locked job `needs:` a lock-free job that runs
 * scripts/e2e/wait-shared-accounts.mjs, which joins the group only when no job
 * is waiting in it and no older run is ahead. This guard, built from the
 * workflow files themselves, requires that of EVERY locked job, and checks the
 * waiter's own inventory parser against a real YAML parse. It is red on the
 * pre-Q743 tree (nine workflows, none with a waiter): the @mutate lines below
 * re-prove that in the vacuity run.
 */
// @mutate .github/workflows/prod-audit.yml |     needs: [preflight, wait-accounts]\n    if: needs.preflight.outputs.have_accounts == 'true' |     needs: preflight\n    if: needs.preflight.outputs.have_accounts == 'true'
// @mutate .github/workflows/e2e-journeys.yml | if: always() && needs.wait-accounts.result == 'success' && needs.preflight | if: always() && needs.preflight
// @mutate .github/workflows/press-every-control.yml |     timeout-minutes: 350\n    permissions:\n      actions: read |     timeout-minutes: 350\n    permissions:\n      actions: none
// @mutate scripts/e2e/wait-shared-accounts.mjs | /rate limit/i.test(body)) return 5 * 60_000; | false) return 5 * 60_000;
// @mutate scripts/e2e/wait-shared-accounts.mjs |       if (e?.waitMs != null) { |       if (false) {
// @mutate scripts/e2e/wait-shared-accounts.mjs |   if (status !== 403 && status !== 429) return null; |   if (status !== 403) return null;
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { decide, lockedJobs, LOCK, rateLimitWaitMs } from "../../scripts/e2e/wait-shared-accounts.mjs";

const WF_DIR = resolve(__dirname, "../../.github/workflows");
const WAITER = "scripts/e2e/wait-shared-accounts.mjs";

type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  concurrency?: string | { group?: string };
  permissions?: Record<string, string> | string;
  "timeout-minutes"?: number;
  steps?: { run?: string }[];
};
type Wf = { jobs?: Record<string, Job> };

const groupOf = (j: Job) => (typeof j.concurrency === "string" ? j.concurrency : j.concurrency?.group);
const needsOf = (j: Job) => (j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs]);
const isWaiter = (j: Job) => (j.steps ?? []).some((s) => String(s.run ?? "").includes(WAITER));

export function lockQueueViolations(dir = WF_DIR): string[] {
  const out: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const jobs = (parse(readFileSync(join(dir, file), "utf8")) as Wf).jobs ?? {};
    for (const [key, job] of Object.entries(jobs)) {
      if (groupOf(job) !== LOCK) continue;
      const waiters = needsOf(job).filter((n) => jobs[n] && isWaiter(jobs[n]));
      if (waiters.length === 0) {
        out.push(`${file}:${key} holds ${LOCK} but needs no job running ${WAITER}`);
        continue;
      }
      // `always()` ignores a failed/timed-out waiter and would walk into the lock anyway.
      if (/always\(\)/.test(String(job.if ?? "")) && !waiters.some((w) => String(job.if).includes(`needs.${w}.result == 'success'`)))
        out.push(`${file}:${key} runs on always() without requiring needs.<waiter>.result == 'success'`);
      for (const w of waiters) {
        const wj = jobs[w];
        if (groupOf(wj)) out.push(`${file}:${w} (the waiter) must hold no concurrency group; it would itself be bumped`);
        const perms = wj.permissions;
        if (typeof perms !== "object" || perms.actions !== "read")
          out.push(`${file}:${w} needs \`permissions: actions: read\` to see the queue`);
        if ((wj["timeout-minutes"] ?? 0) < 330) out.push(`${file}:${w} times out before the longest holder (press, 330 min) can finish`);
      }
    }
  }
  return out;
}

describe("Q743: the shared-accounts lock is entered through a FIFO queue", () => {
  it("every job holding the lock needs a lock-free waiter (and cannot bypass it)", () => {
    expect(lockQueueViolations()).toEqual([]);
  });

  it("the waiter's dependency-free parser finds exactly the locked jobs a real YAML parse finds", () => {
    const fromYaml: Record<string, string[]> = {};
    for (const file of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      const jobs = (parse(readFileSync(join(WF_DIR, file), "utf8")) as Wf).jobs ?? {};
      const keys = Object.entries(jobs).filter(([, j]) => groupOf(j) === LOCK).map(([k]) => k);
      if (keys.length) fromYaml[`.github/workflows/${file}`] = keys;
    }
    const fromScript = Object.fromEntries(
      Object.entries(lockedJobs(WF_DIR)).map(([p, js]) => [p, js.map((j) => j.key)]),
    );
    expect(Object.keys(fromYaml).length).toBeGreaterThanOrEqual(9);
    expect(fromScript).toEqual(fromYaml);
  });

  it("can fail: the pre-Q743 shape (lock jobs needing only preflight) is red", () => {
    const tmp = resolve(__dirname, "../../node_modules/.cache/q743-guard");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const src = readFileSync(join(WF_DIR, "prod-audit.yml"), "utf8");
    writeFileSync(join(tmp, "prod-audit.yml"), src.replace("needs: [preflight, wait-accounts]", "needs: preflight"));
    expect(lockQueueViolations(tmp)).toEqual([
      `prod-audit.yml:prod-audit holds ${LOCK} but needs no job running ${WAITER}`,
    ]);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// The decision itself, on the measured shapes.
const inv = {
  ".github/workflows/prod-audit.yml": [{ key: "prod-audit", name: "Prod audit (prod-audit)" }],
  ".github/workflows/press-every-control.yml": [{ key: "press", name: "Press every control" }],
  ".github/workflows/e2e-journeys.yml": [
    { key: "journeys", name: "Journeys (journeys)" },
    { key: "journeys-webkit", name: "Journeys (journeys-webkit)" },
  ],
  ".github/workflows/e2e-abuse-notifications.yml": [{ key: "suites", name: "Abuse & notifications (${{ matrix.project }})" }],
};
const run = (id: number, at: string, path: string, jobs: { name: string; status: string; conclusion?: string }[]) => ({
  id,
  created_at: at,
  name: path,
  path: `.github/workflows/${path}`,
  html_url: `run/${id}`,
  jobs,
});

describe("Q743: wait-shared-accounts decide()", () => {
  const audit = run(36290267474, "2026-09-27T03:02:50Z", "prod-audit.yml", [
    { name: "What can run", status: "completed", conclusion: "success" },
    { name: "Prod audit (prod-audit)", status: "in_progress" },
  ]);
  const pressPending = run(36297157445, "2026-09-27T05:20:00Z", "press-every-control.yml", [
    { name: "Press every control", status: "pending" },
  ]);

  it("the 2026-09-27 05:26Z shape: loading-states must NOT join while press waits in the group", () => {
    const me = { id: 36297208529, created_at: "2026-09-27T05:26:26Z" };
    expect(decide(me, [audit, pressPending], inv).go).toBe(false);
  });

  it("joins when the holder runs and nothing waits", () => {
    const me = { id: 36297208529, created_at: "2026-09-27T05:26:26Z" };
    expect(decide(me, [audit], inv).go).toBe(true);
  });

  it("first in, first served: an older run still in its waiter goes first", () => {
    const olderWaiting = run(10, "2026-09-27T05:00:00Z", "press-every-control.yml", [
      { name: "Wait for the shared accounts (queue)", status: "in_progress" },
    ]);
    expect(decide({ id: 20, created_at: "2026-09-27T05:10:00Z" }, [audit, olderWaiting], inv).go).toBe(false);
    // ...and the older one is not held back by the newer.
    const newer = run(20, "2026-09-27T05:10:00Z", "prod-audit.yml", [
      { name: "Wait for the shared accounts (queue)", status: "in_progress" },
    ]);
    expect(decide({ id: 10, created_at: "2026-09-27T05:00:00Z" }, [audit, newer], inv).go).toBe(true);
  });

  it("an older run between its two locked legs (journeys -> webkit) goes first", () => {
    const between = run(10, "2026-09-27T05:00:00Z", "e2e-journeys.yml", [
      { name: "Journeys (journeys)", status: "completed", conclusion: "success" },
    ]);
    expect(decide({ id: 20, created_at: "2026-09-27T05:10:00Z" }, [between], inv).go).toBe(false);
  });

  it("a matrix leg waiting for the lock counts as waiting", () => {
    const abuse = run(30, "2026-09-27T06:00:00Z", "e2e-abuse-notifications.yml", [
      { name: "Abuse & notifications (journeys-webkit)", status: "queued" },
    ]);
    expect(decide({ id: 20, created_at: "2026-09-27T05:10:00Z" }, [abuse], inv).go).toBe(false);
  });

  it("a run parked at workflow level (no jobs) is not in the queue: no prod-load deadlock", () => {
    const parked = run(5, "2026-09-27T04:00:00Z", "press-every-control.yml", []);
    expect(decide({ id: 20, created_at: "2026-09-27T05:10:00Z" }, [parked], inv).go).toBe(true);
  });

  it("an older run whose locked jobs were all skipped is not ahead", () => {
    const skipped = run(5, "2026-09-27T04:00:00Z", "prod-audit.yml", [
      { name: "Prod audit (prod-audit)", status: "completed", conclusion: "skipped" },
      { name: "Report nightly result", status: "in_progress" },
    ]);
    expect(decide({ id: 20, created_at: "2026-09-27T05:10:00Z" }, [skipped], inv).go).toBe(true);
  });
});

// 2026-09-28: every waiter hit HTTP 403 on /actions/runs from 01:39Z, gave up
// after 10 tries and joined the group together, and GitHub cancelled the runs
// they bumped (slow-network 36364455813, privacy-journey 36364457749,
// e2e-journeys 36364643259, press 36364641356). A rate limit must mean "wait for
// the reset", never "fall through and join".
describe("wait-shared-accounts rateLimitWaitMs()", () => {
  const now = 1_790_560_000_000;
  it("an exhausted primary limit waits until the reset", () => {
    const headers = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 600) };
    expect(rateLimitWaitMs({ status: 403, headers }, now)).toBe(605_000);
  });
  it("a secondary limit honours retry-after, and a bare 'rate limit' body still waits", () => {
    expect(rateLimitWaitMs({ status: 429, headers: { "retry-after": "90" } }, now)).toBe(90_000);
    expect(rateLimitWaitMs({ status: 403, body: '{"message":"You have exceeded a secondary rate limit"}' }, now)).toBe(300_000);
  });
  it("a permissions 403 or a 500 is NOT a rate limit (counts toward the fall-through)", () => {
    const body = '{"message":"Resource not accessible by integration"}';
    expect(rateLimitWaitMs({ status: 403, headers: { "x-ratelimit-remaining": "812" }, body }, now)).toBeNull();
    expect(rateLimitWaitMs({ status: 500 }, now)).toBeNull();
  });
  it("the poll loop sleeps on a rate limit instead of counting a failure", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/e2e/wait-shared-accounts.mjs"), "utf8");
    const loop = src.slice(src.indexOf("for (;;)"));
    expect(loop.indexOf("e?.waitMs != null")).toBeGreaterThan(-1);
    expect(loop.indexOf("e?.waitMs != null")).toBeLessThan(loop.indexOf("failures += 1"));
  });
});
