/**
 * CLASS GUARD: no job holds the shared prod test accounts for more than an hour.
 *
 * Every prod workflow serialises on the job-level concurrency group
 * `prod-lifecycle-shared-accounts` (Q326, sharedAccountJobsHoldOneLock.test.ts)
 * and queues for it through scripts/e2e/wait-shared-accounts.mjs (Q743). A job
 * holding that lock for hours parks every other prod check behind it:
 * press-every-control's single `press` job was allowed 330 minutes, and run
 * 36697559350 (2026-09-30) held the accounts for ~4.5 h while loading-states,
 * journeys and the rest queued.
 *
 * Built from the workflow files themselves: every job whose concurrency group is
 * the lock must declare a numeric `timeout-minutes` of at most 60. A job that
 * truly cannot be split sits in ALLOWED with its EXACT current timeout and the
 * measured reason; the allowlist is two-way, so it fails when an entry is fixed,
 * removed, or its timeout changes (each needs this file edited in the same
 * commit). Red on 366f83823 (press 330, prod-audit 180 unlisted, slow-network
 * 120, journeys + journeys-webkit 90).
 */
// @mutate .github/workflows/slow-network.yml |     timeout-minutes: 30\n    concurrency: |     timeout-minutes: 61\n    concurrency:
// @mutate .github/workflows/prod-audit.yml |     timeout-minutes: 55 # prod-audit leg 2 (Q889) |     timeout-minutes: 61 # prod-audit leg 2 (Q889)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const WF_DIR = resolve(__dirname, "../../.github/workflows");
const LOCK = "prod-lifecycle-shared-accounts";
export const MAX_LOCKED_MINUTES = 60;

/** Locked jobs that cannot (yet) be split below the cap. Exact, two-way. */
// @two-way src/test/sharedAccountLockJobsAreShort.test.ts:is in ALLOWED but no longer holds
export const ALLOWED: Record<string, { minutes: number; reason: string }> = {
};

type Job = { "timeout-minutes"?: unknown; concurrency?: string | { group?: string } };

export function lockedJobTimeouts(dir = WF_DIR): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const jobs = ((parse(readFileSync(join(dir, file), "utf8")) as { jobs?: Record<string, Job> })?.jobs) ?? {};
    for (const [key, job] of Object.entries(jobs)) {
      const group = typeof job.concurrency === "string" ? job.concurrency : job.concurrency?.group;
      if (group === LOCK) out[`${file}:${key}`] = job["timeout-minutes"];
    }
  }
  return out;
}

export function lockedJobViolations(found: Record<string, unknown>, allowed = ALLOWED): string[] {
  const out: string[] = [];
  for (const [id, t] of Object.entries(found)) {
    const a = allowed[id];
    if (typeof t !== "number") {
      out.push(`${id} holds ${LOCK} with no numeric timeout-minutes (GitHub's default is 360)`);
    } else if (a) {
      if (t <= MAX_LOCKED_MINUTES) out.push(`${id} is fixed (${t} min): remove it from ALLOWED`);
      else if (t !== a.minutes) out.push(`${id} timeout is ${t}, ALLOWED says ${a.minutes}: update the entry exactly`);
    } else if (t > MAX_LOCKED_MINUTES) {
      out.push(`${id} holds ${LOCK} for up to ${t} min (> ${MAX_LOCKED_MINUTES}): split it into legs that each take the lock`);
    }
  }
  for (const id of Object.keys(allowed)) if (!(id in found)) out.push(`${id} is in ALLOWED but no longer holds ${LOCK}`);
  return out;
}

describe("no job holds the shared prod accounts for more than an hour", () => {
  const found = lockedJobTimeouts();

  it("finds the locked jobs (inventory from the workflow files, not a list)", () => {
    expect(Object.keys(found).length).toBeGreaterThanOrEqual(12);
  });

  it(`every locked job has timeout-minutes <= ${MAX_LOCKED_MINUTES}, or an exact ALLOWED entry`, () => {
    expect(lockedJobViolations(found)).toEqual([]);
  });

  it("every ALLOWED entry gives a reason", () => {
    for (const [id, a] of Object.entries(ALLOWED)) expect(a.reason.length, id).toBeGreaterThan(40);
  });

  it("can fail in every direction", () => {
    expect(lockedJobViolations({ "a.yml:j": 330 }, {})).toHaveLength(1);
    expect(lockedJobViolations({ "a.yml:j": undefined }, {})).toHaveLength(1);
    expect(lockedJobViolations({ "a.yml:j": 60 }, { "a.yml:j": { minutes: 90, reason: "x" } })).toEqual([
      "a.yml:j is fixed (60 min): remove it from ALLOWED",
    ]);
    expect(lockedJobViolations({ "a.yml:j": 120 }, { "a.yml:j": { minutes: 90, reason: "x" } })).toHaveLength(1);
    expect(lockedJobViolations({}, { "a.yml:j": { minutes: 90, reason: "x" } })).toHaveLength(1);
    expect(lockedJobViolations({ "a.yml:j": 60 }, {})).toEqual([]);
  });
});
