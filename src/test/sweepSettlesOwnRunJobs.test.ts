/*
 * CLASS GUARD: a journey run that is CANCELLED mid-chain leaves nothing in
 * escrow on the shared test seats.
 *
 * Measured 2026-11-04 (read-only SQL + run logs): three "[E2E DO NOT ACCEPT]"
 * jobs sat hired+funded on the 0902 seats for over a day (d62ad01c from
 * e2e-journeys 41700760650, 9ce18a98 from 41737043318, 3801d1da from
 * 41741012840). Each run was cancelled inside 02-marketplace's chain, so the
 * spec's afterAll never settled its job, and each run's own teardown sweep
 * logged "too young to settle forward ... may be a live run's job" for the row
 * it had just made. No later sweep ran for 24 h.
 *
 * The fix (scripts/e2e/ownRunJobs.mjs): every journey spec that can fund a job
 * records the id the moment it has one; the teardown sweep of the same
 * workflow job walks those ids forward whatever their age. A pre sweep never
 * lifts the gate, and a row nobody recorded keeps the 6 h rule.
 *
 * Inventory from source: every e2e/journeys spec that drives a payment
 * (settleJobForward or a Checkout payer) must call recordOwnRunJob, and every
 * e2e-journeys job that runs the journeys must set SWEEP_OWN_JOB_IDS_FILE.
 */

// @mutate scripts/e2e/ownRunJobs.mjs |   return phase === "teardown" && ownIds.has(String(id).toLowerCase()); |   return false;
// @mutate scripts/e2e/ownRunJobs.mjs |   return phase === "teardown" && ownIds.has(String(id).toLowerCase()); |   return ownIds.has(String(id).toLowerCase());
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | const OWN_RUN_JOB_IDS = PHASE === "teardown" ? readOwnRunJobIds() : new Set(); | const OWN_RUN_JOB_IDS = new Set();
// @mutate e2e/journeys/02-marketplace.spec.ts |       recordOwnRunJob(S.jobId); |       void S.jobId;
// @mutate .github/workflows/e2e-journeys.yml | (scripts/e2e/ownRunJobs.mjs).\n      SWEEP_OWN_JOB_IDS_FILE: journey-own-jobs.txt | (scripts/e2e/ownRunJobs.mjs).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
import { mayWalkForward, readOwnRunJobIds, recordOwnRunJob, OWN_RUN_JOBS_ENV } from "../../scripts/e2e/ownRunJobs.mjs";

const read = (p: string) => readFileSync(p, "utf8");
const SIX_H = 6 * 60 * 60 * 1000;
const ID = "9ce18a98-3eaa-4fd6-add5-4873bfea6306";

describe("mayWalkForward", () => {
  const own = new Set([ID]);
  it("a young row this run recorded is walked at teardown", () => {
    expect(mayWalkForward({ id: ID, ageMs: 30 * 60_000, minAgeMs: SIX_H, phase: "teardown", ownIds: own })).toBe(true);
  });
  it("the same row is NOT walked by a pre sweep (another run may be driving it)", () => {
    expect(mayWalkForward({ id: ID, ageMs: 30 * 60_000, minAgeMs: SIX_H, phase: "pre", ownIds: own })).toBe(false);
  });
  it("a young row nobody recorded keeps the 6 h rule", () => {
    expect(
      mayWalkForward({ id: "3801d1da-371b-4d73-8249-1b923e663a8b", ageMs: 30 * 60_000, minAgeMs: SIX_H, phase: "teardown", ownIds: own }),
    ).toBe(false);
  });
  it("an old row is walked by any sweep", () => {
    expect(mayWalkForward({ id: "x", ageMs: SIX_H + 1, minAgeMs: SIX_H, phase: "pre", ownIds: new Set() })).toBe(true);
  });
});

describe("record and read round trip", () => {
  it("records only uuids, reads them back, and is a no-op without the env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "own-run-jobs-"));
    try {
      const env = { [OWN_RUN_JOBS_ENV]: join(dir, "ids.txt") };
      expect(recordOwnRunJob(ID.toUpperCase(), env)).toBe(true);
      expect(recordOwnRunJob("not-a-uuid", env)).toBe(false);
      expect([...readOwnRunJobIds(env)]).toEqual([ID]);
      expect(recordOwnRunJob(ID, {})).toBe(false);
      expect(readOwnRunJobIds({}).size).toBe(0);
      expect(readOwnRunJobIds({ [OWN_RUN_JOBS_ENV]: join(dir, "missing.txt") }).size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the sweeper reads this run's ids at teardown only", () => {
  const code = blankComments(read("scripts/e2e/prod-lifecycle-sweeper.mjs"));
  it("loads the ids only in the teardown phase and gates the walk on mayWalkForward", () => {
    expect(code).toContain('const OWN_RUN_JOB_IDS = PHASE === "teardown" ? readOwnRunJobIds() : new Set();');
    expect(code).toMatch(/mayWalkForward\(\{[^}]*ownIds: OWN_RUN_JOB_IDS,?[^}]*\}\)/);
  });
});

describe("every payment-driving journey records its jobs", () => {
  const files = readdirSync("e2e/journeys", { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => join("e2e/journeys", f));
  const PAYS = /\b(settleJobForward|payOnStripeCheckout|payCheckoutSession|payCheckoutUrlInChromium|payInChromium|payInPageAnsweringReturn)\b/;
  const paying = files.filter((f) => PAYS.test(blankComments(read(f))));

  it("inventories the payment-driving specs (floor)", () => {
    expect(paying.length).toBeGreaterThan(4);
  });

  it.each(paying)("%s calls recordOwnRunJob", (f) => {
    expect(blankComments(read(f))).toMatch(/\brecordOwnRunJob\(/);
  });
});

describe("every e2e-journeys job that runs the journeys names the ids file", () => {
  type Job = { env?: Record<string, string>; steps?: Array<{ run?: string }> };
  const doc = parse(read(".github/workflows/e2e-journeys.yml")) as { jobs: Record<string, Job> };
  const running = Object.entries(doc.jobs).filter(([, j]) => (j.steps ?? []).some((s) => /npx playwright test --project=journeys/.test(s.run ?? "")));

  it("inventories the journey legs (floor)", () => {
    expect(running.length).toBeGreaterThan(1);
  });

  it.each(running.map(([k]) => k))("%s sets SWEEP_OWN_JOB_IDS_FILE at job level", (k) => {
    const job = doc.jobs[k];
    expect(job.env?.SWEEP_OWN_JOB_IDS_FILE, `${k} has no SWEEP_OWN_JOB_IDS_FILE`).toBeTruthy();
    expect((job.steps ?? []).some((s) => /sweep-both-seats\.sh/.test(s.run ?? ""))).toBe(true);
  });
});
