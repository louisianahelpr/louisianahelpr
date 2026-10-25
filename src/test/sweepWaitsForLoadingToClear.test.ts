/**
 * The prod sweeps judge a screen "still loading" only after giving its
 * placeholders a bounded time to clear.
 *
 * a11y-webkit-prod (nightly-red #2375, red since 2026-10-05) failed its gate on
 * run 39967663191 (2026-10-23) with two captures "still loading" (135
 * helper-profile-security phone-light: 16 skeleton bones; 357 admin-health
 * phone-dark: 13), while the same two screens passed in every other variant of
 * that run. e2e/happy-path/sweepCore.ts ran its stuck check ONCE, 500 ms after
 * networkidle. RED on origin/main 8ca225a0e3: no wait before the check.
 */
// @mutate e2e/happy-path/sweepCore.ts |       .waitForFunction(`(${detectStuckOrBlank.toString()})() === null`, undefined, { timeout: STILL_LOADING_WAIT_MS }) |       .waitForTimeout(0)
// @mutate e2e/happy-path/sweepCore.ts | export const STILL_LOADING_WAIT_MS = 15_000; | export const STILL_LOADING_WAIT_MS = 500;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(__dirname, "../../e2e/happy-path/sweepCore.ts"), "utf8"));

describe("sweepCore waits for loading placeholders before the stuck check", () => {
  it("waits on the same detector it judges with, before judging", () => {
    const wait = src.indexOf("waitForFunction(`(${detectStuckOrBlank.toString()})() === null`");
    const judge = src.indexOf("const stuck = await page.evaluate(detectStuckOrBlank);");
    expect(wait).toBeGreaterThan(-1);
    expect(judge).toBeGreaterThan(wait);
  });

  it("the wait is long enough to matter and still bounded", () => {
    const ms = Number(src.match(/export const STILL_LOADING_WAIT_MS = ([\d_]+);/)?.[1].replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(5_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("a screen still loading after the wait is still reported (the gate keeps its teeth)", () => {
    expect(src).toMatch(/if \(boundary\) result\.wrongScreen = boundary;/);
  });
});
