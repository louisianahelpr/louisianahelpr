// @mutate e2e/prod-audit/legs.json |     "saved-helper-row.spec.ts"\n  ], |     "saved-helper-row.spec.ts",\n    "saved-helper-row.spec.ts"\n  ],
// @mutate .github/workflows/prod-audit.yml |           FILES=$(node scripts/e2e/prod-audit-leg.mjs "$LEG") |           FILES=""
// @mutate .github/workflows/prod-audit.yml |       max-parallel: 1 |       max-parallel: 2
/*
 * Q889 (2026-10-07): prod-audit holds the shared test accounts in two legs,
 * each under the one-hour cap (src/test/sharedAccountLockJobsAreShort.test.ts
 * no longer allows a 180-minute prod-audit). The split is e2e/prod-audit/legs.json.
 *
 * Pinned: every prod-audit spec on disk is in exactly one leg (a new spec that
 * is in neither would silently never run: Playwright is handed the leg's files),
 * the workflow runs each leg's files from that list, and the legs take the
 * lock one after the other (max-parallel 1), never side by side.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs module
import { legFiles } from "../../scripts/e2e/prod-audit-leg.mjs";

const ROOT = join(__dirname, "..", "..");
const legs = JSON.parse(readFileSync(join(ROOT, "e2e/prod-audit/legs.json"), "utf8")) as Record<string, string[] | string>;

describe("prod-audit runs in two locked legs (Q889)", () => {
  it("every prod-audit spec is in exactly one leg", () => {
    const onDisk = readdirSync(join(ROOT, "e2e/prod-audit")).filter((f) => f.endsWith(".spec.ts")).sort();
    expect(onDisk.length).toBeGreaterThan(20);
    const listed = [...(legs.a as string[]), ...(legs.b as string[])];
    expect(listed.length, "a spec listed in both legs, or twice").toBe(new Set(listed).size);
    expect([...listed].sort()).toEqual(onDisk);
  });

  it("the leg script hands Playwright that leg's files, and refuses an unknown leg", () => {
    expect(legFiles("a")).toContain("e2e/prod-audit/rail-inset.spec.ts");
    expect(legFiles("b")).toContain("e2e/prod-audit/shell-spacing.spec.ts");
    expect(() => legFiles("c")).toThrow(/no leg "c"/);
  });

  it("the workflow runs both legs, one at a time, each under the hour, from the leg list", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/prod-audit.yml"), "utf8")) as {
      jobs: Record<string, { strategy?: { "max-parallel"?: number; matrix?: { leg?: string[] } }; "timeout-minutes"?: number; steps?: { name?: string; run?: string }[] }>;
    };
    const job = wf.jobs["prod-audit"];
    expect(job.strategy?.matrix?.leg).toEqual(["a", "b"]);
    expect(job.strategy?.["max-parallel"]).toBe(1);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(60);
    const run = job.steps?.find((s) => s.name === "Run the prod audit suites")?.run ?? "";
    expect(run).toContain('FILES=$(node scripts/e2e/prod-audit-leg.mjs "$LEG")');
    expect(run.match(/\$FILES\b/g)?.length, "both the grep and the full branch pass the leg's files").toBe(2);
  });
});
