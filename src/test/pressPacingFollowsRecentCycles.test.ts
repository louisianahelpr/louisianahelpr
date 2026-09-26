/**
 * #1582, press run 36208184593 (2026-09-26, the first run with ceiling pacing): shard 1
 * averaged ~125 requests/min against a 400 ceiling, yet did not reach 37 rows
 * (14 before pacing): `/home` customer 44 min for 81 presses, `/home` helper
 * 50 min for 67 (9.5 and 8 min in run 36069319716). The burst estimate was the
 * run's all-time largest cycle, so one heavy cycle held every later cycle to
 * one per minute. Pacing to exactly the ceiling still peaked at 455.
 *
 * Now the estimate is the largest of the last RECENT_CYCLES cycles and the
 * pacer aims PACE_HEADROOM below the ceiling.
 *
 * @mutate scripts/audit/pressFailureClass.mjs |   const window = (recent ?? []).slice(-RECENT_CYCLES); |   const window = recent ?? [];
 * @mutate scripts/audit/press-every-control.mjs | ceiling: Math.floor(LOAD_CEILING * PACE_HEADROOM), | ceiling: LOAD_CEILING,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { MIN_CYCLE_BURST, PACE_HEADROOM, RECENT_CYCLES, ceilingWaitMs, cycleBurstEstimate } from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "..", "..");
const MIN = 60_000;

describe("press pacing follows the recent cycles (#1582)", () => {
  it("one heavy cycle stops dominating after RECENT_CYCLES lighter ones", () => {
    const cycles = [380, ...Array.from({ length: RECENT_CYCLES }, () => 60)];
    expect(cycleBurstEstimate(cycles.slice(0, 3))).toBe(380);
    expect(cycleBurstEstimate(cycles)).toBe(MIN_CYCLE_BURST);
  });

  it("with the recent estimate, a /home-like row keeps pressing inside one minute", () => {
    const now = 1000 * MIN + 20_000;
    const ceiling = Math.floor(400 * PACE_HEADROOM);
    const burst = cycleBurstEstimate([380, ...Array.from({ length: RECENT_CYCLES }, () => 60)]);
    expect(ceilingWaitMs({ minutes: { 1000: 150 }, now, ceiling, burst })).toBe(0);
    // The all-time-max rule this replaces would have waited out the minute here.
    expect(ceilingWaitMs({ minutes: { 1000: 150 }, now, ceiling, burst: 380 })).toBeGreaterThan(0);
  });

  it("the pacer aims below the ceiling it is judged by, and uses the recent estimate", () => {
    expect(PACE_HEADROOM).toBeGreaterThan(0.5);
    expect(PACE_HEADROOM).toBeLessThan(1);
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/ceilingWaitMs\(\{ minutes: requestMeter\.minutes, ceiling: Math\.floor\(LOAD_CEILING \* PACE_HEADROOM\), burst: cycleBurstEstimate\(recentCycles\) \}\)/);
    expect(src).not.toMatch(/cycleBurst = Math\.max\(/);
  });
});
