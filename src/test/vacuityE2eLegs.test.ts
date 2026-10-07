import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { E2E_LEGS, collectMutations, selectKind, selectShard, shardOf } from "../../scripts/vacuity/run.mjs";

/**
 * Q1270: vacuity's Playwright registrations hold the shared test accounts, and
 * the weekly full set (~99 at ~98 s each, about 160 min) ran in ONE locked job
 * of up to 180 minutes, three times the hour any holder may take. It now runs
 * in E2E_LEGS sequential legs, each its own waiter + lock job under an hour,
 * each mutating `--shard k/E2E_LEGS` of the set.
 */
const WF = parse(readFileSync(resolve(__dirname, "../../.github/workflows/vacuity.yml"), "utf8")) as {
  jobs: Record<string, { "timeout-minutes"?: number; needs?: string[]; steps?: { run?: string }[] }>;
};
const legKey = (k: number) => (k === 1 ? "vacuity-e2e" : `vacuity-e2e-${k}`);

describe("vacuity's e2e registrations run in legs under the lock cap (Q1270)", () => {
  it("every registration lands in exactly one leg, and a guard file never splits", () => {
    const { mutations } = collectMutations();
    const e2e = selectKind(mutations, "e2e");
    expect(e2e.length, "inventory floor: the Playwright registrations").toBeGreaterThan(50);
    const legs = Array.from({ length: E2E_LEGS }, (_, i) => selectShard(e2e, i + 1, E2E_LEGS));
    expect(legs.reduce((n, l) => n + l.length, 0)).toBe(e2e.length);
    const legOf = shardOf(e2e, E2E_LEGS);
    for (const m of e2e) expect(legs[legOf.get(m.guard)! - 1]).toContain(m);
  });

  it("the full set fits each leg's lock time at the measured ~98 s a registration", () => {
    const e2e = selectKind(collectMutations().mutations, "e2e");
    const biggest = Math.max(...Array.from({ length: E2E_LEGS }, (_, i) => selectShard(e2e, i + 1, E2E_LEGS).length));
    // Plus ~8 min of checkout, install, browsers and the deploy wait.
    expect((biggest * 98) / 60 + 8, `the largest leg has ${biggest} registrations`).toBeLessThanOrEqual(57);
  });

  it("the workflow has one lock job per leg, each under the cap, each running its own shard", () => {
    for (let k = 1; k <= E2E_LEGS; k++) {
      const job = WF.jobs[legKey(k)];
      expect(job, legKey(k)).toBeTruthy();
      expect(job["timeout-minutes"], "sharedAccountLockJobsAreShort.test.ts MAX_LOCKED_MINUTES").toBeLessThanOrEqual(60);
      const gate = (job.steps ?? []).map((s) => s.run ?? "").find((r) => r.includes("npm run vacuity"));
      expect(gate, `${legKey(k)} runs the gate`).toBeTruthy();
      expect(gate!.match(new RegExp(`--shard ${k}/${E2E_LEGS}\\b`, "g"))?.length, `${legKey(k)} passes --shard ${k}/${E2E_LEGS} on all three paths`).toBe(3);
      if (k > 1) expect(WF.jobs[`wait-accounts-${k}`]?.needs).toContain(legKey(k - 1));
    }
    expect(readFileSync(resolve(__dirname, "sharedAccountLockJobsAreShort.test.ts"), "utf8"), "the ALLOWED exception is gone").not.toContain('"vacuity.yml:vacuity-e2e"');
  });
});
// @mutate scripts/vacuity/run.mjs | export const E2E_LEGS = 4; | export const E2E_LEGS = 2;
// @mutate .github/workflows/vacuity.yml |             npm run vacuity:all -- --e2e --shard 3/4 |             npm run vacuity:all -- --e2e
// @mutate scripts/vacuity/run.mjs |   return mutations.filter((m) => legOf.get(m.guard) === k); |   return mutations;
