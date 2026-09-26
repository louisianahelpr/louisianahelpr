/**
 * Q56: every speed fix ships with a budget so it cannot regress. The Lighthouse
 * gate (lighthouse.yml, weekly, mobile-simulated) only asserted the blended
 * performance SCORE, which can hold while one metric regresses. Measured
 * 2026-09-26 with the CI settings on a local build (prod backend): FCP
 * 3.4-3.8 s, LCP 5.8-6.6 s, TBT 94-176 ms across /, /browse, /login, /signup.
 *
 * This holds each metric as an ERROR-level budget, set from that measurement:
 * not below it (a budget the app already misses turns the gate red for no
 * change), and not more than 40% above the worst route (a loose budget hides the
 * next regression). Lower the budget in the same commit as the fix that lowers
 * the number (CLAUDE.md: every budget is exact both ways).
 *
 * @mutate .lighthouserc.json | "largest-contentful-paint": ["error", { "maxNumericValue": 8000 }] | "largest-contentful-paint": ["warn", { "maxNumericValue": 8000 }]
 * @mutate .lighthouserc.json | "first-contentful-paint": ["error", { "maxNumericValue": 4500 }] | "first-contentful-paint": ["error", { "maxNumericValue": 9000 }]
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Assertion = [string, { maxNumericValue?: number; minScore?: number }];
const cfg = JSON.parse(readFileSync(resolve(__dirname, "../../.lighthouserc.json"), "utf8"));

// Q401a (2026-09-25) split the single global `assertions` block into a per-URL
// `assertMatrix` (one row for /, /browse; one for /login, /signup, which turns
// off `is-crawlable` since those pages are deliberately noindex). Every row still
// carries the Q56 speed budgets below, so every measured route is still gated on
// all three metrics -- this reads every row rather than one, so a future row that
// drops a budget fails here instead of silently losing coverage.
type MatrixRow = { matchingUrlPattern: string; assertions: Record<string, Assertion> };
const rows: MatrixRow[] = cfg.ci.assert.assertMatrix;

/** Worst route measured 2026-09-26 (ms), from the comment in .lighthouserc.json. */
const MEASURED_WORST: Record<string, number> = {
  "first-contentful-paint": 3773,
  "largest-contentful-paint": 6646,
  "total-blocking-time": 176,
};

describe("Lighthouse metric budgets (Q56)", () => {
  it("the measurement is recorded next to the budgets", () => {
    const comment = (cfg._comment as string[]).join("\n");
    expect(comment).toMatch(/METRIC BUDGETS \(Q56, measured 2026-09-26/);
    expect(Object.keys(MEASURED_WORST).length).toBe(3);
  });

  it("every matrix row exists", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const [metric, worst] of Object.entries(MEASURED_WORST)) {
    it(`${metric} is an error-level budget within 10-40% above the measured worst on every row (TBT: floor 300 ms)`, () => {
      for (const row of rows) {
        const a = row.assertions[metric];
        expect(a, `${metric} has no assertion on row ${row.matchingUrlPattern}`).toBeDefined();
        expect(a[0]).toBe("error");
        const max = a[1].maxNumericValue ?? NaN;
        // TBT is small and noisy on shared runners, so it gets an absolute floor.
        const lo = metric === "total-blocking-time" ? 300 : worst * 1.1;
        const hi = metric === "total-blocking-time" ? 800 : worst * 1.4;
        expect(max).toBeGreaterThanOrEqual(lo);
        expect(max).toBeLessThanOrEqual(hi);
      }
    });
  }

  it("the blended score gate is still an error on every row", () => {
    for (const row of rows) {
      expect(row.assertions["categories:performance"][0]).toBe("error");
    }
  });
});
