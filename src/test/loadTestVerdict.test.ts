/**
 * Q60 (2026-10-06): the first full ramp exited 0 although every message write
 * was refused (the hard-coded seed job had been deleted, 403 at each step) and
 * no realtime delivery was ever measured; an abort exited 0 too. loadVerdict
 * decides the exit code: only a run that measured what it claims is green.
 *
 * @mutate scripts/load/loadVerdict.mjs |   if (sends.length && !ok.length) { |   if (false) {
 * @mutate scripts/load/loadVerdict.mjs |   if (result.abortReason) return `aborted: ${result.abortReason}`; |   if (false) return "";
 * @mutate scripts/load/loadVerdict.mjs |   if (ok.length && !delivered) return | if (false) return
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { loadVerdict } from "../../scripts/load/loadVerdict.mjs";

const step = (msgEvents: number) => ({ realtime: { msgEvents } });

describe("the load test fails unless it measured what it claims (Q60)", () => {
  it("the 2026-10-06 run: every send refused 403 -> FAIL", () => {
    const sends = [1, 2, 3, 4].map((seq) => ({ seq, status: 403 }));
    expect(loadVerdict({ abortReason: null, steps: [step(0)], sends })).toMatch(/every message write was refused \(403\)/);
  });
  it("an aborted run -> FAIL", () => {
    expect(loadVerdict({ abortReason: "step 3: p95 over 1500ms", steps: [], sends: [] })).toMatch(/^aborted: step 3/);
  });
  it("sends landed but no subscriber got one -> FAIL", () => {
    expect(loadVerdict({ abortReason: null, steps: [step(0), step(0)], sends: [{ status: 201 }] })).toMatch(/no subscriber received one/);
  });
  it("sends landed and were delivered -> pass", () => {
    expect(loadVerdict({ abortReason: null, steps: [step(0), step(3)], sends: [{ status: 201 }, { status: 403 }] })).toBeNull();
  });
});
