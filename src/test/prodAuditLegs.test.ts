import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * Q889 (2026-10-07): prod-audit held the shared test accounts for up to 180
 * minutes in one job (122 test-minutes measured on run 37521973791, messy-input
 * alone 58), three times the hour any holder may take. prod-audit.yml now runs
 * FOUR sequential legs, each a waiter + a lock job of at most 55 minutes:
 * messy-input in two halves (MESSY_INPUT_LEG=1|2, leg 2 fed leg 1's credit
 * files), and every other prod-audit spec in two named lists, Web Vitals last.
 *
 * The class this holds: every prod-audit spec is run by exactly one leg (the
 * messy-input file by exactly legs 1 and 2, one half each), every leg stays
 * under the cap, and leg 2's coverage check gets leg 1's credits.
 */
const ROOT = resolve(__dirname, "..", "..");
type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string> };
type Job = { "timeout-minutes"?: number; concurrency?: { group?: string }; steps?: Step[]; needs?: string[] };
const WF = parse(readFileSync(join(ROOT, ".github/workflows/prod-audit.yml"), "utf8")) as { jobs: Record<string, Job> };
const LEGS = ["prod-audit", "prod-audit-2", "prod-audit-3", "prod-audit-4"];
const MESSY = "e2e/prod-audit/messy-input.spec.ts";

/** The spec files a leg's prod-audit run step names (both of its grep/no-grep lines must agree). */
function legFiles(key: string): string[] {
  const step = (WF.jobs[key].steps ?? []).find((s) => /^Run the prod audit suites/.test(s.name ?? ""));
  expect(step, `${key} has no prod-audit run step`).toBeTruthy();
  const lines = (step!.run ?? "").split("\n").filter((l) => l.includes("--project=prod-audit"));
  expect(lines.length, `${key}: one command per grep branch`).toBe(2);
  const sets = lines.map((l) => l.split(/\s+/).filter((t) => /^e2e\/prod-audit\/.+\.spec\.ts$/.test(t)).sort());
  expect(sets[0], `${key}: the grep and no-grep commands name different files`).toEqual(sets[1]);
  return sets[0];
}

describe("prod-audit runs in legs under the shared-account cap (Q889)", () => {
  const specs = readdirSync(join(ROOT, "e2e/prod-audit")).filter((f) => f.endsWith(".spec.ts")).map((f) => `e2e/prod-audit/${f}`).sort();

  it("finds the specs (inventory floor)", () => {
    expect(specs.length).toBeGreaterThan(15);
    expect(specs).toContain(MESSY);
  });

  it("every prod-audit spec is run by exactly one leg; messy-input by legs 1 and 2, one half each", () => {
    const runs = new Map<string, string[]>();
    for (const leg of LEGS) for (const f of legFiles(leg)) runs.set(f, [...(runs.get(f) ?? []), leg]);
    const wrong = specs.filter((f) => {
      const by = runs.get(f) ?? [];
      return f === MESSY ? by.join(",") !== "prod-audit,prod-audit-2" : by.length !== 1;
    });
    expect(wrong.map((f) => `${f}: ${runs.get(f)?.join(", ") ?? "no leg"}`)).toEqual([]);
    const legEnv = (k: string) => (WF.jobs[k].steps ?? []).find((s) => /^Run the prod audit suites/.test(s.name ?? ""))?.env?.MESSY_INPUT_LEG;
    expect([legEnv("prod-audit"), legEnv("prod-audit-2")]).toEqual(["1", "2"]);
  });

  it("each leg holds the lock for at most 55 minutes", () => {
    for (const leg of LEGS) {
      expect(WF.jobs[leg].concurrency?.group, leg).toBe("prod-lifecycle-shared-accounts");
      expect(WF.jobs[leg]["timeout-minutes"], leg).toBeLessThanOrEqual(55);
    }
    expect(readFileSync(join(ROOT, "src/test/sharedAccountLockJobsAreShort.test.ts"), "utf8")).not.toContain('"prod-audit.yml:prod-audit"');
  });

  it("leg 2's coverage check is handed leg 1's credit files", () => {
    const up = (WF.jobs["prod-audit"].steps ?? []).find((s) => (s.uses ?? "").startsWith("actions/upload-artifact") && s.with?.name === "messy-input-credits-leg-1");
    expect(up?.with?.path, "leg 1 uploads its credits").toMatch(/messy-input-prod\/credits/);
    const steps = WF.jobs["prod-audit-2"].steps ?? [];
    const down = steps.findIndex((s) => (s.uses ?? "").startsWith("actions/download-artifact") && s.with?.name === "messy-input-credits-leg-1");
    const run = steps.findIndex((s) => /^Run the prod audit suites/.test(s.name ?? ""));
    expect(down, "leg 2 downloads them").toBeGreaterThan(-1);
    expect(down, "before it runs").toBeLessThan(run);
    expect(steps[run].env?.MESSY_INPUT_PRIOR_CREDITS).toBe(steps[down].with?.path);
  });
});
// @mutate .github/workflows/prod-audit.yml | e2e/prod-audit/rail-inset.spec.ts e2e/prod-audit/page-settle.spec.ts | e2e/prod-audit/rail-inset.spec.ts
// @mutate .github/workflows/prod-audit.yml |     timeout-minutes: 55 # prod-audit leg 3 (Q889) |     timeout-minutes: 120 # prod-audit leg 3 (Q889)
// @mutate .github/workflows/prod-audit.yml |           MESSY_INPUT_PRIOR_CREDITS: messy-input-prior-credits |           MESSY_INPUT_PRIOR_CREDITS: elsewhere
