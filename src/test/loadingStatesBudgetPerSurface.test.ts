/**
 * THE LOADING-STATES REQUEST BUDGET IS PER SURFACE (docs/OPEN.md Q1901, Q104;
 * nightly-red #2601; lead 11-05 7:10 PM, the Q1374 unit fix).
 *
 * measure-loading-states.mjs never set the meter's `tests`, so request-budget.mjs
 * read perTest as the WHOLE RUN's total. That total grows with the surface
 * list (139 surfaces on 10-01, 232 on 11-05), so the 2116 budget went red at
 * 3375 while requests per surface FELL (2099/139 = 15.1 -> 3375/232 = 14.5).
 * Now `tests` = surfaces measured, and the budget is 15.1 per surface: a list
 * that grows passes, a real per-surface rise still fails, both ways.
 *
 * @mutate scripts/audit/measure-loading-states.mjs |         requestMeter.tests = results.length; |         void results.length;
 * @mutate e2e/request-budgets.json |       "perTest": 15.1, |       "perTest": 2116,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { aggregate, judge, budgetFor } from "../../scripts/e2e/request-budget.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const budgets = JSON.parse(read("e2e/request-budgets.json")).budgets;
const budget = budgetFor(budgets, "loading-states");

/** One run's sample, as the meter flushes it. */
const run = (total: number, tests: number) =>
  aggregate([{ label: "loading-states", total, byClass: {}, signIns: 0, duplicates: 0, tests, minutes: { m: 1 }, topDuplicates: {} }])["loading-states"];

// The three measured runs (requests summed from measurements.json; each run's
// per-surface `requests` sums to its meter total exactly).
const MEASURED = [
  { run: "36787610054 (10-01)", total: 2099, surfaces: 139 },
  { run: "measurements.json on main (10-07)", total: 2811, surfaces: 201 },
  { run: "42123572431 (11-05, #2601)", total: 3375, surfaces: 232 },
];

describe("loading-states request budget is requests per surface", () => {
  it("the measurer counts surfaces as the meter's tests", () => {
    const src = blankComments(read("scripts/audit/measure-loading-states.mjs"));
    const sets = src.match(/requestMeter\.tests\s*=\s*results\.length\s*;/g) ?? [];
    expect(sets.length).toBeGreaterThan(0);
    // It is set after each surface lands in `results`, so an exit-time flush
    // of a run that dies midway is per surface too.
    const push = src.indexOf("results.push(r);");
    expect(push).toBeGreaterThan(-1);
    expect(src.indexOf("requestMeter.tests = results.length;", push)).toBeGreaterThan(push);
  });

  it("the budget is a per-surface number at the 10-01 level", () => {
    expect(budget.perTest).toBe(15.1);
    expect(budget.signIns).toBe(0);
  });

  it("every measured run passes, though the surface list grew 67%", () => {
    expect(MEASURED.length).toBeGreaterThan(2);
    for (const m of MEASURED) {
      const { failures } = judge(run(m.total, m.surfaces), budget);
      expect(failures, m.run).toEqual([]);
    }
  });

  it("a real per-surface rise goes red, and so does a stale budget", () => {
    // +1 request on every one of today's 232 surfaces: 15.5 per surface.
    const over = judge(run(3375 + 232, 232), budget).failures;
    expect(over.join("\n")).toMatch(/perTest 15\.5 is over its budget 15\.1/);
    // Under half (7.55): the budget is stale and must be lowered.
    const stale = judge(run(7 * 232, 232), budget).failures;
    expect(stale.join("\n")).toMatch(/under half its budget/);
    // The old unit (tests never set) reads the whole run and fails at once.
    expect(judge(run(3375, 0), budget).failures.join("\n")).toMatch(/perTest 3375 is over/);
  });
});
