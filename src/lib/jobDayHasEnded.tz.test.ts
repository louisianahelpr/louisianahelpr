// @mutate src/lib/jobDate.ts | return end !== null && nowMs >= end; | return nowMs >= start + 0;
/*
 * TZ SWEEP: a job's day ends at the next CENTRAL midnight, whatever zone the
 * reader's device is in. The browse feed used the device's own midnight, so a
 * UTC-set phone dropped every Louisiana job dated today from 19:00 Central
 * (Q21, 2026-09-23). Runs in the `tz-sweep` vitest project (forks pool), where
 * assigning process.env.TZ actually moves the runtime zone — checked below.
 */
import { describe, it, expect, afterAll } from "vitest";
import { jobDayHasEnded } from "@/lib/jobDate";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ["America/Chicago", "UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
// 2026-09-23 in Central runs 05:00Z (23rd) to 05:00Z (24th).
const CASES: [string, boolean][] = [
  ["2026-09-23T04:59:00Z", false], // 23:59 Central on the 22nd: job on the 23rd not over
  ["2026-09-23T20:00:00Z", false], // 15:00 Central on the 23rd
  ["2026-09-24T01:00:00Z", false], // 20:00 Central on the 23rd — UTC already says the 24th
  ["2026-09-24T04:59:00Z", false], // 23:59 Central on the 23rd
  ["2026-09-24T05:00:00Z", true],  // Central midnight: the day is over
  ["2026-09-25T12:00:00Z", true],
];

describe("jobDayHasEnded is the same in every device zone", () => {
  it("the zone switch is real", () => {
    process.env.TZ = "Asia/Tokyo";
    const tokyo = new Date("2026-09-23T00:00:00Z").getTimezoneOffset();
    process.env.TZ = "America/Chicago";
    const chicago = new Date("2026-09-23T00:00:00Z").getTimezoneOffset();
    expect(tokyo).not.toBe(chicago);
  });

  for (const tz of ZONES) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      for (const [iso, ended] of CASES) {
        expect(jobDayHasEnded("2026-09-23", Date.parse(iso)), `${tz} @ ${iso}`).toBe(ended);
      }
      expect(jobDayHasEnded("not-a-date", Date.now())).toBe(false);
      expect(jobDayHasEnded(null, Date.now())).toBe(false);
    });
  }
});
