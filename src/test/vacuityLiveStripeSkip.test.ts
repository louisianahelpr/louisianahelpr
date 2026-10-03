/*
 * GUARD (docs/OPEN.md Q1144, nightly-red #2183): while Stripe is LIVE, a
 * guard whose EVERY test skips with the documented live-pay reason is scored
 * "live-stripe" (counted, listed, two-way), not INCONCLUSIVE. Any other
 * all-skip, and any mixed run, keeps its old verdict. Before this, no full
 * vacuity run could pass: e2e/job-status-fixtures/accepted.spec.ts needs a
 * hired, funded job, which cannot be minted before launch (owner 2026-10-02:
 * never complete a live payment), so it skipped every test, every week.
 */
// @mutate scripts/vacuity/lib.mjs | if (reasons.length && reasons.every((d) => d.startsWith(LIVE_PAY_SKIP_PREFIX))) livePay++; | livePay++;
// @mutate scripts/vacuity/lib.mjs | allLivePay: tests > 0 && skipped === tests && livePay === tests | allLivePay: livePay > 0
// @mutate scripts/vacuity/index.mjs | const unlistedLive = liveGuards.filter((g) => !liveListed.has(g)); | const unlistedLive = [];
// @mutate scripts/vacuity/run.mjs | "--reporter=line,json" | "--reporter=line"
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { skipCensus, LIVE_PAY_SKIP_PREFIX } from "../../scripts/vacuity/lib.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const LIVE = `${LIVE_PAY_SKIP_PREFIX} "nightly skips pay steps in live mode" — no accepted job`;
const test = (status: string, skipReason?: string) => ({
  status,
  annotations: skipReason === undefined ? [] : [{ type: "skip", description: skipReason }],
  results: [{ status: status === "skipped" ? "skipped" : "passed" }],
});
const report = (...tests: unknown[]) => ({ suites: [{ specs: [{ tests: tests.slice(0, 1) }], suites: [{ specs: [{ tests: tests.slice(1) }] }] }] });

describe("skipCensus (Q1144)", () => {
  it("every test skipped for the live-pay reason: allLivePay", () => {
    const c = skipCensus(report(test("skipped", LIVE), test("skipped", LIVE)));
    expect(c).toEqual({ tests: 2, skipped: 2, livePay: 2, allLivePay: true });
  });

  it("one test that RAN keeps it out", () => {
    expect(skipCensus(report(test("skipped", LIVE), test("expected"))).allLivePay).toBe(false);
  });

  it("a skip for any other reason (no .env, no session) keeps it out", () => {
    const c = skipCensus(report(test("skipped", LIVE), test("skipped", "sessions unavailable: no .env")));
    expect(c.livePay).toBe(1);
    expect(c.allLivePay).toBe(false);
  });

  it("a skip with no reason at all is not a live-pay skip", () => {
    expect(skipCensus(report(test("skipped"), test("skipped"))).allLivePay).toBe(false);
  });

  it("an empty or missing report is never allLivePay", () => {
    expect(skipCensus({ suites: [] }).allLivePay).toBe(false);
    expect(skipCensus(null).allLivePay).toBe(false);
  });
});

describe("the prefix is the one the specs actually skip with", () => {
  it("LIVE_PAY_SKIP in fundedOpenJobPlan.ts starts with LIVE_PAY_SKIP_PREFIX", () => {
    const src = read("e2e/prod-audit/fundedOpenJobPlan.ts");
    const m = /export const LIVE_PAY_SKIP =\s*"([^"]*)/.exec(src);
    expect(m?.[1], "LIVE_PAY_SKIP moved or changed shape; re-point this guard").toBeTruthy();
    expect(m![1].startsWith(LIVE_PAY_SKIP_PREFIX)).toBe(true);
  });

  it("every listed guard reaches the live-pay fixture (fundedOpenJob)", () => {
    const listed: string[] = JSON.parse(read("src/test/vacuity.baseline.json")).liveSkipGuards;
    expect(listed.length).toBeGreaterThan(0);
    for (const g of listed) expect(read(g), g).toMatch(/from "\.\.\/prod-audit\/fundedOpenJob"/);
  });
});

describe("wiring", () => {
  it("the runner asks Playwright for a JSON report and scores live-pay all-skips on their own", () => {
    const run = read("scripts/vacuity/run.mjs");
    expect(run).toContain('"--reporter=line,json"');
    expect(run).toContain("PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut");
    expect(run).toMatch(/census\?\.allLivePay/);
    expect(run).toMatch(/verdict: "live-stripe"/);
  });

  it("the gate fails an unlisted live-stripe guard and a listed one that ran (two-way)", () => {
    const idx = read("scripts/vacuity/index.mjs");
    expect(idx).toContain("const unlistedLive = liveGuards.filter((g) => !liveListed.has(g));");
    expect(idx).toMatch(/if \(unlistedLive\.length\)\s*\n\s*fail\(/);
    expect(idx).toMatch(/if \(ranListed\.length\)\s*\n\s*fail\(/);
    expect(idx).toContain("const staleLiveSkip =");
  });
});
