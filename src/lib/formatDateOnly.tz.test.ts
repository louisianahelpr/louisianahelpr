// @mutate src/lib/format.ts | const d = toDisplayDate(date);\n  if (isNaN(d.getTime())) return "";\n  const opts | const d = typeof date === "string" ? new Date(date) : date;\n  if (isNaN(d.getTime())) return "";\n  const opts
// @mutate src/lib/format.ts | return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(date); | return new Date(date);
/*
 * TZ SWEEP (Q405): a bare DATE column ("2026-10-07", e.g. recurrence_end_date)
 * passed to formatShortDate / formatTimestamp must print that calendar day in
 * every device zone. `new Date("2026-10-07")` is UTC midnight, which printed
 * "Oct 6" in America/Chicago. Runs in the `tz-sweep` vitest project (forks
 * pool), where assigning process.env.TZ really moves the runtime zone.
 */
import { describe, it, expect, afterAll } from "vitest";
import { formatShortDate, formatTimestamp } from "@/lib/format";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ["America/Chicago", "America/Los_Angeles", "UTC", "Asia/Tokyo"];

describe("date-only strings render as the same calendar day in every zone", () => {
  it("the zone switch is real", () => {
    process.env.TZ = "Asia/Tokyo";
    const tokyo = new Date("2026-10-07T00:00:00Z").getTimezoneOffset();
    process.env.TZ = "America/Chicago";
    const chicago = new Date("2026-10-07T00:00:00Z").getTimezoneOffset();
    expect(tokyo).not.toBe(chicago);
  });

  for (const tz of ZONES) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      expect(formatShortDate("2026-10-07")).toMatch(/^Oct 7\b/);
      expect(formatTimestamp("2026-10-07")).toBe("Oct 7, 2026");
      expect(formatShortDate("2026-01-01")).toMatch(/^Jan 1\b/);
    });
  }

  it("timestamps are still instants (not truncated to a day)", () => {
    process.env.TZ = "America/Chicago";
    // 03:00Z on the 8th is 22:00 Central on the 7th.
    expect(formatTimestamp("2026-10-08T03:00:00Z")).toBe("Oct 7, 2026");
  });

  it("covers more than one zone (floor)", () => {
    expect(ZONES.length).toBeGreaterThan(2);
  });
});
