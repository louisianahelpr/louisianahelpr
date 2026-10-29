/**
 * F28 (app audit 2026-10-28, part 4 half 2): scripts/audit/prod-seed.mjs hung
 * its 34-message "SEED thread" on the NEWEST poster-e2e <-> helper-e2e job in a
 * working state. During the audit that was the live audit job, so a re-seed
 * moved 34 seed messages into the chat the audit was driving. A seed writes
 * only to rows it owns: the thread goes on one of its own durable state
 * fixtures (scripts/e2e/seedStateFixtures.mjs), never on a job another run made.
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: prod-seed picked the
 * thread job with `pairJobs.find(...) ?? pairJobs[0]` (the source case below).
 *
 * @mutate scripts/audit/seedThreadJob.mjs |   const own = [...ownJobIds].map((id) => byId.get(id)).filter(Boolean); |   const own = pairJobs;
 * @mutate scripts/audit/seedThreadJob.mjs |   return own.find((j) => SEED_THREAD_STATUSES.includes(j.status)) ?? own[0] ?? null; |   return own.find((j) => SEED_THREAD_STATUSES.includes(j.status)) ?? pairJobs[0] ?? null;
 * @mutate scripts/audit/prod-seed.mjs |   const threadJob = pickSeedThreadJob(pairJobs, [fixtureId("job:helper-completed"), ...stateFixtures]); |   const threadJob = pairJobs[0];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { pickSeedThreadJob } from "../../scripts/audit/seedThreadJob.mjs";
import { stateFixtureJobIds, fixtureId } from "../../scripts/e2e/seedStateFixtures.mjs";

const ROOT = resolve(__dirname, "../..");
const SEED = blankComments(readFileSync(resolve(ROOT, "scripts/audit/prod-seed.mjs"), "utf8"));

const OWN = stateFixtureJobIds();
const COMPLETED = fixtureId("job:helper-completed");
const PREFERENCE = [COMPLETED, ...OWN];
// Newest first, as prod-seed reads them (order=created_at.desc): a live audit's job leads.
const AUDIT_JOB = { id: "43931567-0000-4000-8000-000000000001", status: "in_progress" };
const pairJobs = [
  AUDIT_JOB,
  { id: OWN[0], status: "accepted" },
  { id: COMPLETED, status: "completed" },
];

describe("F28: prod-seed's long thread goes only on a job the seed owns", () => {
  it("inventory floor: the seed owns state fixtures to choose from", () => {
    expect(OWN.length).toBeGreaterThan(3);
    expect(OWN).toContain(COMPLETED);
  });

  it("never the newest pair job when another run made it", () => {
    expect(pickSeedThreadJob(pairJobs, PREFERENCE)?.id).not.toBe(AUDIT_JOB.id);
  });

  it("the completed state fixture first", () => {
    expect(pickSeedThreadJob(pairJobs, PREFERENCE)?.id).toBe(COMPLETED);
  });

  it("another own fixture when the completed one is missing", () => {
    expect(pickSeedThreadJob([AUDIT_JOB, { id: OWN[0], status: "accepted" }], PREFERENCE)?.id).toBe(OWN[0]);
  });

  it("no own fixture: no thread job (the caller skips the thread), even with other pair jobs present", () => {
    expect(pickSeedThreadJob([AUDIT_JOB], PREFERENCE)).toBeNull();
  });

  it("prod-seed picks its thread job through it, and every thread write uses that job", () => {
    expect(SEED).toContain('const threadJob = pickSeedThreadJob(pairJobs, [fixtureId("job:helper-completed"), ...stateFixtures]);');
    expect(SEED).not.toMatch(/const threadJob = pairJobs\./);
    const threadBlock = SEED.slice(SEED.indexOf("const thread = !threadJob"), SEED.indexOf("const heavyThread"));
    expect(threadBlock).toContain("job_id: threadJob.id,");
  });
});
