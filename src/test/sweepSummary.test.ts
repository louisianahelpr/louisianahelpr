/**
 * The prod lifecycle sweeper told every nightly "OK — all stranded rows
 * unwound." while leaving funded jobs behind. On 2026-09-20 prod held five
 * such rows in escrow, the oldest created 2026-09-15 — five days of a green
 * line over a growing residue (e2e-journeys run 35323456007 logged three of
 * them and still printed OK).
 *
 * These cases are built from that exact run's rows, so the first one fails on
 * the old flat string and passes only on a line that names what was left.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper shared with the sweeper script
import { summariseSweep, DEFERRED_STALE_MS } from "../../scripts/e2e/sweepSummary.mjs";

const NOW = Date.parse("2026-09-20T09:00:00Z");
const at = (iso: string) => ({ id: iso, created_at: iso });

describe("summariseSweep", () => {
  it("does not claim every row unwound when rows were left to settle forward", () => {
    // The three rows e2e-journeys 35323456007 deferred, plus the two newer ones.
    const deferred = [
      { id: "5ef2658f-9b89-4585-8b20-6434bb021388", created_at: "2026-09-15T08:20:11Z" },
      { id: "dd9e4db7-2173-428c-b612-bc02f4def187", created_at: "2026-09-16T15:02:33Z" },
      { id: "f3ef3e2a-eb34-4d89-98c4-3e353f21b80d", created_at: "2026-09-16T15:02:56Z" },
      { id: "0c8bab55-1d0b-4123-a2ce-c78dc43492be", created_at: "2026-09-18T14:37:34Z" },
      { id: "e7e09075-a8c6-44b0-9c11-4ee42b8849ea", created_at: "2026-09-18T14:38:07Z" },
    ];
    const s = summariseSweep({ listed: 9, deferred, now: NOW });

    expect(s.line).not.toBe("OK — all stranded rows unwound.");
    expect(s.ok).toBe(false);
    // Three of the five are past 48h at NOW; the two from 2026-09-18 are 42h
    // old and still inside the window where "settles forward" is plausible.
    expect(s.stale.map((r: { id: string }) => r.id)).toEqual([
      "5ef2658f-9b89-4585-8b20-6434bb021388",
      "dd9e4db7-2173-428c-b612-bc02f4def187",
      "f3ef3e2a-eb34-4d89-98c4-3e353f21b80d",
    ]);
    expect(s.line).toContain("5ef2658f-9b89-4585-8b20-6434bb021388");
    expect(s.line).toContain("5 row(s) left to settle forward");
    // The oldest is the one the line leads with, at its real age.
    expect(s.line).toContain("5.0 day(s) old");
  });

  it("still says OK when a deferred row is young enough to actually settle forward", () => {
    const s = summariseSweep({
      listed: 4,
      deferred: [at(new Date(NOW - DEFERRED_STALE_MS / 2).toISOString())],
      now: NOW,
    });
    expect(s.ok).toBe(true);
    expect(s.stale).toEqual([]);
    expect(s.line).toContain("OK — every other stranded row unwound");
  });

  it("keeps the two clean outcomes exactly as they were", () => {
    expect(summariseSweep({ listed: 0, deferred: [], now: NOW }).line).toBe("OK — nothing stranded.");
    expect(summariseSweep({ listed: 6, deferred: [], now: NOW }).line).toBe("OK — all stranded rows unwound.");
  });
});
