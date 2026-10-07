import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

/**
 * Q1405: press-every-control's last wave runs out of time, and the job logs
 * only say a row's summary line, so "/admin?view=people 27.3 min for 57
 * presses" had to be read off the gaps between log lines. The sweep now times
 * every row (start to the next row's start) and every control's wait on the
 * request ceiling, and writes the slowest rows into coverage.md, so the next
 * run says whether the cost is the presses or the pacing.
 */
type Timing = { route: string; persona: string; ms: number; presses: number; paceMs: number };
const rowTimings = harness.rowTimings as (r: unknown[], endedAt: number) => Timing[];

describe("press-every-control says where its time went (Q1405)", () => {
  it("bounds each row by the next row's start, and the last by the run's end, slowest first", () => {
    const t = rowTimings(
      [
        { route: "/a", persona: "admin", startedAt: 0, pressed: 10, paceMs: 1000 },
        { route: "/b", persona: "admin", startedAt: 60_000, pressed: 2, paceMs: 0 },
        { route: "/c", persona: "customer", startedAt: 70_000, pressed: 5, paceMs: 0 },
        { route: "/redirect", persona: "anon" },
      ],
      400_000,
    );
    expect(t.map((x) => [x.route, x.ms])).toEqual([["/c", 330_000], ["/a", 60_000], ["/b", 10_000]]);
    expect(t.find((x) => x.route === "/a")).toMatchObject({ presses: 10, paceMs: 1000 });
  });

  it("the sweep stamps every row and press, and writes the table", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/audit/press-every-control.mjs"), "utf8");
    expect(src).toMatch(/controls: \[\], notes: \[\], net: null, nonApp: \[\], startedAt: Date\.now\(\), paceMs: 0 \}/);
    expect(src).toMatch(/rec\.paceMs \+= paceMs;/);
    expect(src).toMatch(/## Where the time went \(slowest rows\)/);
  });
});
// @mutate scripts/audit/press-every-control.mjs |       ms: Math.max(0, (started[i + 1]?.startedAt ?? endedAt) - r.startedAt), |       ms: 0,
// @mutate scripts/audit/press-every-control.mjs |           rec.paceMs += paceMs; |           void paceMs;
