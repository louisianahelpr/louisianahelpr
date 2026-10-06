/**
 * Every OPEN launch-list item names the one thing it waits on, so a status
 * report is read from docs/OPEN.md by scripts/launch-status.mjs, never
 * remembered (owner, 2026-10-06: a report said 26 items only needed a prod
 * check when half were not built).
 *
 * @mutate docs/OPEN.md | - **lead** (Claude can finish it now): Q975 Q1314 | - **lead** (Claude can finish it now): Q975
 * @mutate scripts/launch-status.mjs | if (states.get(q) !== "done" && !map.has(q)) problems.push | if (false) problems.push
 * @mutate scripts/launch-status.mjs | if (!ids.includes(q)) problems.push | if (false) problems.push
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file (as launchListProgress.test.ts)
import { WAITS_ON_START, WAITS_ON_END, waitsOnProblems, parseWaitsOn, launchListIds } from "../../scripts/launch-status.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { LAUNCH_LIST_START, LAUNCH_LIST_END } from "../../scripts/scoreboard.mjs";

const OPEN_MD = readFileSync(join(__dirname, "..", "..", "docs/OPEN.md"), "utf8");

describe("launch items say what they wait on", () => {
  it("every open launch item has exactly one waits-on category, and every waits-on Q is on the list", () => {
    expect(waitsOnProblems(OPEN_MD)).toEqual([]);
    // floor: the real list is read, not an empty block
    expect(launchListIds(OPEN_MD).length).toBeGreaterThanOrEqual(31);
    expect(parseWaitsOn(OPEN_MD).map.size).toBeGreaterThanOrEqual(1);
  });

  it("the checks fire on a missing, an unlisted and a doubled entry (synthetic)", () => {
    const text = (waits: string) =>
      [LAUNCH_LIST_START, "- A: Q1, Q2", LAUNCH_LIST_END, WAITS_ON_START, waits, WAITS_ON_END, "- [ ] **Q1 a**", "- [~] **Q2 b**"].join("\n");
    expect(waitsOnProblems(text("- **lead** (x): Q1 Q2"))).toEqual([]);
    expect(waitsOnProblems(text("- **lead** (x): Q1"))).toEqual(["Q2 is open on the launch list but has no waits-on line"]);
    expect(waitsOnProblems(text("- **lead** (x): Q1 Q2 Q9"))).toEqual(["Q9 has a waits-on line but is not on the launch list"]);
    expect(waitsOnProblems(text("- **lead** (x): Q1 Q2\n- **launch-day** (y): Q2"))).toEqual(["Q2 is listed under two waits-on categories"]);
  });
});
