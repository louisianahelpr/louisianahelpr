import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { E2E_COST, E2E_LEGS, collectMutations, legBudget, legEstimates, runMutations, selectKind, selectShard, shardOf } from "../../scripts/vacuity/run.mjs";

/**
 * Q1270: vacuity's Playwright registrations hold the shared test accounts, and
 * the weekly full set ran in ONE locked job of up to 180 minutes, three times
 * the hour any holder may take. It runs in E2E_LEGS sequential legs, each its
 * own waiter + lock job under an hour, each mutating `--shard k/E2E_LEGS`.
 *
 * Q1426 (CLASS GUARD: a lock-holding leg whose estimated duration exceeds its
 * timeout). Q1270 sized four legs at "~98 s a registration", a number no full
 * run had measured, and this file checked `registrations x 98 s + 8 <= 57`,
 * which four legs of 25-26 passed. The first full run in legs (scheduled
 * 38145674494, 2026-10-11) had legs 1-3 CANCELLED at 57 min, holding the
 * shared accounts for ~3 h with almost no verdict: every guard file's
 * unmutated baseline runs before any mutation, and those phases alone took
 * 52.9, 51.7 and 47.6 min. The estimate is now built from measured per-file and
 * per-registration minutes (run.mjs E2E_COST), and must fit each leg's timeout
 * with LEG_FILL margin; a leg that still runs long stops itself at
 * --budget-minutes, before the timeout. Red on the old config: four legs
 * estimate 65.7-76.7 min each against 57 (count-balanced, as they ran).
 */
const WF = parse(readFileSync(resolve(__dirname, "../../.github/workflows/vacuity.yml"), "utf8")) as {
  jobs: Record<string, { "timeout-minutes"?: number; needs?: string[]; steps?: { run?: string }[] }>;
};
const legKey = (k: number) => (k === 1 ? "vacuity-e2e" : `vacuity-e2e-${k}`);
const gateOf = (k: number) => (WF.jobs[legKey(k)]?.steps ?? []).map((s) => s.run ?? "").find((r) => r.includes("npm run vacuity"));

/**
 * A leg's estimate may use at most this share of its timeout; the rest is
 * margin for runner and prod variance. Not lower: every leg is 43 locked
 * minutes, and the run's worst case must end inside the Sunday window
 * prodWorkflowSpacing.test.ts rule 5 allows (Sun 05:17 to db-drift-detect's
 * 13:17 = 480 min since 2026-10-12, Q1721: 10 legs x 43 + 15 at most), so more
 * margin needs a shorter set or a longer window.
 */
const LEG_FILL = 0.87;
/** Minutes kept between the end of --budget-minutes and the job timeout (the report and the .env removal). */
const BUDGET_TAIL = 2;

/*
 * The measurements E2E_COST must not undercut (dated record, run 38145674494,
 * 2026-10-11, job logs of legs 1-3; ~/.lh-shots/vacuity-legs/). Baseline phase =
 * "mutating N e2e registration(s)" to the first verdict line.
 */
const MEASURED_2026_10_11 = {
  // [baseline-phase minutes, guard files] for the files beside a11y-prod: leg 2, leg 3, leg 1 minus a11y-prod's two runs.
  baselinePhases: [[51.7, 20], [47.6, 19], [36.9, 17]] as const,
  // Seconds of the 15 mutated runs those legs finished.
  mutationSeconds: [118, 24, 24, 26.6, 13.8, 41, 26.6, 42, 38, 37.6, 24, 31, 8, 107, 8],
  // a11y-prod.spec.ts: "121 passed (7.9m)".
  a11yProdMinutes: 7.9,
};

describe("vacuity's e2e registrations run in legs under the lock cap (Q1270, Q1426)", () => {
  const e2e = selectKind(collectMutations().mutations, "e2e");

  it("every registration lands in exactly one leg, and a guard file never splits", () => {
    expect(e2e.length, "inventory floor: the Playwright registrations").toBeGreaterThan(50);
    const legs = Array.from({ length: E2E_LEGS }, (_, i) => selectShard(e2e, i + 1, E2E_LEGS));
    expect(legs.reduce((n, l) => n + l.length, 0)).toBe(e2e.length);
    const legOf = shardOf(e2e, E2E_LEGS);
    for (const m of e2e) expect(legs[legOf.get(m.guard)! - 1]).toContain(m);
  });

  it("E2E_COST does not undercut what the 2026-10-11 full run measured", () => {
    const [mins, files] = MEASURED_2026_10_11.baselinePhases.reduce(([a, b], [m, f]) => [a + m, b + f], [0, 0]);
    expect(E2E_COST.baselineMinutes, `measured ${(mins / files).toFixed(2)} min a guard file`).toBeGreaterThanOrEqual(mins / files);
    const mut = MEASURED_2026_10_11.mutationSeconds;
    expect(E2E_COST.mutationMinutes, "mean mutated run").toBeGreaterThanOrEqual(mut.reduce((a, b) => a + b, 0) / mut.length / 60);
    expect(E2E_COST.heavySpecMinutes["e2e/a11y-prod/a11y-prod.spec.ts"]).toBeGreaterThanOrEqual(MEASURED_2026_10_11.a11yProdMinutes);
    expect(E2E_COST.setupMinutes, "checkout to gate step was 1.3-1.5 min").toBeGreaterThanOrEqual(1.5);
  });

  it("every lock-holding leg's estimated minutes fit its timeout with margin", () => {
    const est = legEstimates(e2e, E2E_LEGS);
    const over: string[] = [];
    for (let k = 1; k <= E2E_LEGS; k++) {
      const timeout = WF.jobs[legKey(k)]?.["timeout-minutes"] ?? 360;
      const minutes = E2E_COST.setupMinutes + est[k - 1];
      if (minutes > LEG_FILL * timeout)
        over.push(`leg ${k}: ~${minutes.toFixed(1)} min estimated against a ${timeout}-min timeout (limit ${(LEG_FILL * timeout).toFixed(1)})`);
    }
    expect(over, "raise E2E_LEGS (and add the leg jobs to vacuity.yml) until every leg fits").toEqual([]);
  });

  it("each leg stops itself at --budget-minutes before its timeout, and the budget holds the leg's estimate", () => {
    const est = legEstimates(e2e, E2E_LEGS);
    for (let k = 1; k <= E2E_LEGS; k++) {
      const gate = gateOf(k);
      const timeout = WF.jobs[legKey(k)]?.["timeout-minutes"] ?? 360;
      const budgets = [...(gate ?? "").matchAll(/--budget-minutes (\d+)/g)].map((m) => Number(m[1]));
      expect(budgets.length, `${legKey(k)} passes --budget-minutes on all three paths`).toBe(3);
      for (const b of budgets) {
        expect(E2E_COST.setupMinutes + b, `${legKey(k)}: setup + budget leaves ${BUDGET_TAIL} min before the timeout`).toBeLessThanOrEqual(timeout - BUDGET_TAIL);
        expect(est[k - 1], `${legKey(k)}: its estimate fits its own budget`).toBeLessThanOrEqual(b);
      }
    }
  });

  it("a run that does not fit the leg's remaining budget is not started, and nothing after it is", () => {
    const t = 1_000_000;
    const b = legBudget(t + 3 * 60_000, () => t);
    expect(b.fits("e2e/a.spec.ts"), "a 2.5-min baseline fits 3 min").toBe(true);
    expect(b.fits("e2e/a11y-prod/a11y-prod.spec.ts"), "an 8-min run does not").toBe(false);
    expect(b.fits("e2e/a.spec.ts", true), "and once spent, nothing after it starts").toBe(false);
    expect(b.timeoutMs(), "no spawn may outlive the deadline").toBe(3 * 60_000);
    expect(legBudget(null).fits("e2e/a11y-prod/a11y-prod.spec.ts"), "no budget: everything fits").toBe(true);
  });

  it("a leg past its budget runs nothing and scores every registration INCONCLUSIVE (a red gate, never a pass)", () => {
    // A guard that does not exist: were anything spawned or written, this would throw, not pass.
    const fake = [1, 2].map((i) => ({ guard: "e2e/__no-such-guard__.spec.ts", target: `__no_such_target_${i}__.ts`, find: "a", replace: "b", line: i }));
    const results = runMutations(fake as unknown as Parameters<typeof runMutations>[0], { deadline: Date.now() - 1 });
    expect(results.map((r) => r.verdict)).toEqual(["inconclusive", "inconclusive"]);
    for (const r of results) expect(r.why).toMatch(/--budget-minutes ran out/);
  });

  it("the workflow has one lock job per leg, each under the cap, each running its own shard", () => {
    for (let k = 1; k <= E2E_LEGS; k++) {
      const job = WF.jobs[legKey(k)];
      expect(job, legKey(k)).toBeTruthy();
      expect(job["timeout-minutes"], "sharedAccountLockJobsAreShort.test.ts MAX_LOCKED_MINUTES").toBeLessThanOrEqual(60);
      const gate = gateOf(k);
      expect(gate, `${legKey(k)} runs the gate`).toBeTruthy();
      expect(gate!.match(new RegExp(`--shard ${k}/${E2E_LEGS}\\b`, "g"))?.length, `${legKey(k)} passes --shard ${k}/${E2E_LEGS} on all three paths`).toBe(3);
      if (k > 1) expect(WF.jobs[`wait-accounts-${k}`]?.needs).toContain(legKey(k - 1));
    }
    expect(WF.jobs[legKey(E2E_LEGS + 1)], "no leg job beyond E2E_LEGS").toBeUndefined();
    expect(readFileSync(resolve(__dirname, "sharedAccountLockJobsAreShort.test.ts"), "utf8"), "the ALLOWED exception is gone").not.toContain('"vacuity.yml:vacuity-e2e"');
  });
});
// @mutate scripts/vacuity/run.mjs | export const E2E_LEGS = 9; | export const E2E_LEGS = 4;
// @mutate .github/workflows/vacuity.yml |             npm run vacuity:all -- --e2e --shard 3/9 --budget-minutes 39 |             npm run vacuity:all -- --e2e --shard 3/9
// @mutate scripts/vacuity/run.mjs |   return mutations.filter((m) => legOf.get(m.guard) === k); |   return mutations;
// @mutate scripts/vacuity/run.mjs |   baselineMinutes: 2.5, |   baselineMinutes: 1.6,
// @mutate scripts/vacuity/run.mjs |       if (!spent && remainingMs() < e2eRunMinutes(guard, isMutation) * 60_000) spent = true; |       if (!spent && remainingMs() < 0) spent = true;
