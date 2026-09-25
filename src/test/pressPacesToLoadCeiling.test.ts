// @mutate scripts/audit/press-every-control.mjs |           await paceToCeiling(page); |           void paceToCeiling;
// @mutate scripts/audit/pressFailureClass.mjs |   if (used === 0 \|\| used + Math.min(burst, ceiling) <= ceiling) return 0; |   return 0;
/**
 * press-every-control stays under the prod load ceiling it is judged by.
 *
 * Run 36069319716's "Backend request budget (Q104)" step failed shards 1 and 4:
 *   press-every-control: 599 backend requests in its busiest minute, over the 400/min ceiling
 *   press-every-control: 587 backend requests in its busiest minute, over the 400/min ceiling
 * with averages near 190/min. The harness now waits for the next minute when
 * the current minute's count plus its largest measured press-cycle burst would
 * pass the ceiling, and it reads that ceiling from e2e/request-budgets.json.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import { ceilingWaitMs } from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "..", "..");
type Wait = (o: { minutes: Record<number, number>; now: number; ceiling: number; burst: number }) => number;
const wait = ceilingWaitMs as Wait;
const MIN = 60_000;

describe("press-every-control paces itself to ceilingPerMinute", () => {
  it("goes at once while this minute has room for one more burst", () => {
    const now = 1000 * MIN + 10_000;
    expect(wait({ minutes: { 1000: 250 }, now, ceiling: 400, burst: 150 })).toBe(0);
    expect(wait({ minutes: {}, now, ceiling: 400, burst: 150 })).toBe(0);
  });

  it("waits for the next minute when one more burst would pass the ceiling", () => {
    const now = 1000 * MIN + 10_000;
    const ms = wait({ minutes: { 1000: 300 }, now, ceiling: 400, burst: 150 });
    expect(ms).toBeGreaterThanOrEqual(50_000);
    expect(ms).toBeLessThanOrEqual(50_100);
  });

  it("a burst larger than the ceiling starts on an empty minute rather than never", () => {
    const now = 1000 * MIN + 1_000;
    expect(wait({ minutes: { 1000: 0 }, now, ceiling: 400, burst: 900 })).toBe(0);
    expect(wait({ minutes: { 1000: 1 }, now, ceiling: 400, burst: 900 })).toBeGreaterThan(0);
  });

  it("the harness paces every press cycle, with the ceiling read from the budgets file", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/budgetFor\(JSON\.parse\(readFileSync\(resolve\(REPO, "e2e\/request-budgets\.json"\)/);
    const loop = src.slice(src.indexOf("const item = queue[idx++];"), src.indexOf("rec.found++; totalFound++;"));
    expect(loop.length).toBeGreaterThan(0);
    expect(loop).toMatch(/await paceToCeiling\(page\);/);
    const budgets = JSON.parse(readFileSync(resolve(ROOT, "e2e/request-budgets.json"), "utf8"));
    expect(typeof budgets.budgets["*"].ceilingPerMinute).toBe("number");
  });
});
