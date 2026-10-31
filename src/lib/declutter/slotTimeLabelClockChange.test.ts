/**
 * AUD31-6: on the day the clocks go back (Sun Nov 1, 2026, 2 AM CDT -> 1 AM
 * CST) the 1 AM hour happens twice, so a one-hour slot read
 * "1:00 AM – 1:00 AM" next to "1:00 AM – 2:00 AM". A slot that touches a
 * repeated or skipped hour now names the zone (CDT/CST); every other slot
 * reads as before.
 *
 * @mutate src/lib/declutter/sellerDelivery.ts | if (!nearClockChange(start) && !nearClockChange(end)) return plain; | return plain;
 */
import { describe, expect, it } from "vitest";
import { slotLabel, slotTimeLabel } from "./sellerDelivery";

describe("slotTimeLabel across the clock change", () => {
  it("names the zone on the night the clocks go back", () => {
    // 05:00Z = 12 AM CDT, 06:00Z = 1 AM CDT, 07:00Z = 1 AM CST, 08:00Z = 2 AM CST.
    const labels = ["2026-11-01T05:00:00Z", "2026-11-01T06:00:00Z", "2026-11-01T07:00:00Z"].map((s) => slotTimeLabel(s, 60));
    expect(labels).toEqual(["12:00 AM – 1:00 AM CDT", "1:00 AM CDT – 1:00 AM CST", "1:00 AM CST – 2:00 AM"]);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l).not.toMatch(/^(\d+:\d\d [AP]M) – \1$/);
  });

  it("names the zone on the night the clocks go forward", () => {
    // Sun Mar 14, 2027: 2 AM CST -> 3 AM CDT. 07:00Z = 1 AM CST, 08:00Z = 3 AM CDT.
    expect(slotTimeLabel("2027-03-14T07:00:00Z", 60)).toBe("1:00 AM CST – 3:00 AM CDT");
  });

  it("an ordinary slot and a daytime slot on the change day read as before", () => {
    expect(slotTimeLabel("2026-10-31T19:00:00Z", 60)).toBe("2:00 PM – 3:00 PM");
    expect(slotTimeLabel("2026-11-01T20:00:00Z", 60)).toBe("2:00 PM – 3:00 PM");
    expect(slotLabel("2026-11-01T20:00:00Z", 60)).toBe("Sun, Nov 1, 2:00 PM – 3:00 PM");
  });
});
