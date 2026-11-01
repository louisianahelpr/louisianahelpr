/**
 * Deep audit #2 + #58: the seller's pickup windows, summarised for the item page and turned into the buyer's
 * day + time chips by the server's own rule (declutter_slot_in_windows: America/Chicago, a 30-minute slot that
 * starts at or after the window start and ends by the window end; declutter_book_pickup: in the future and
 * ending by the 7-day deadline).
 *
 * @mutate src/lib/declutter/pickupSlots.ts |       for (let m = minutes(w.starts); m + SLOT_MIN <= minutes(w.ends); m += SLOT_MIN) starts.add(m); |       for (let m = minutes(w.starts); m <= minutes(w.ends); m += SLOT_MIN) starts.add(m);
 * @mutate src/lib/declutter/pickupSlots.ts |       .filter(({ at }) => at > nowMs && at + SLOT_MIN * 60_000 <= end)\n      .map(({ m, at }) => | .filter(({ at }) => at + SLOT_MIN * 60_000 <= end)\n      .map(({ m, at }) =>
 * @mutate src/lib/declutter/pickupSlots.ts |   const second = wall - zoneOffsetMs(first); |   const second = first;
 * @mutate src/lib/declutter/pickupSlots.ts |     runs.push(j - i >= 2 ? |     runs.push(false ?
 */
import { describe, expect, it } from "vitest";
import { pickupDays, windowsSummary, type SellerWindow } from "@/lib/declutter/pickupSlots";

const weekdays = (days: number[], starts: string, ends: string): SellerWindow[] => days.map((weekday) => ({ weekday, starts, ends }));

describe("windowsSummary: one line for the item page", () => {
  it("joins runs of days that share a range, the owner's example first", () => {
    expect(windowsSummary(weekdays([1, 2, 3, 4, 5], "17:00:00", "20:00:00"))).toBe("Mon–Fri 5–8 PM");
    expect(windowsSummary([...weekdays([1, 2, 3, 4, 5], "17:00", "20:00"), { weekday: 6, starts: "09:00", ends: "12:00" }]))
      .toBe("Mon–Fri 5–8 PM; Sat 9 AM–12 PM");
    expect(windowsSummary(weekdays([0, 6], "09:30", "13:00"))).toBe("Sun, Sat 9:30 AM–1 PM");
    expect(windowsSummary(weekdays([1, 3], "08:00", "10:00"))).toBe("Mon, Wed 8–10 AM");
    expect(windowsSummary([])).toBe("");
  });
});

describe("pickupDays: only slots the server books", () => {
  // Wed 2026-10-28 15:00 Chicago (CDT, UTC-5) = 20:00Z. Paid that morning: deadline 7 days on.
  const now = Date.parse("2026-10-28T20:00:00Z");
  const deadline = Date.parse("2026-11-04T14:00:00Z");

  it("half-hour starts inside each window, the last one 30 minutes before its end, none in the past", () => {
    const days = pickupDays(weekdays([3], "14:00", "17:00"), now, deadline);
    // Today (Wed 28th): 3:00 PM is now, so 3:30 and 4:00 PM (4:30 would end at 5:00, the window's end: allowed).
    expect(days[0].ymd).toBe("2026-10-28");
    expect(days[0].slots.map((s) => s.label)).toEqual(["3:30 PM", "4:00 PM", "4:30 PM"]);
    expect(days[0].slots[0].iso).toBe("2026-10-28T20:30:00.000Z");
    // Next Wednesday (Nov 4) is after the deadline's end of day? The deadline is 8:00 AM Nov 4, so no Nov 4 slots.
    expect(days.map((d) => d.ymd)).toEqual(["2026-10-28"]);
  });

  it("keeps Chicago wall time across the 1 Nov 2026 DST change (CDT -> CST)", () => {
    const days = pickupDays(weekdays([0, 1], "17:00", "18:00"), now, deadline);
    const sun = days.find((d) => d.ymd === "2026-11-01")!;
    const mon = days.find((d) => d.ymd === "2026-11-02")!;
    // 5:00 PM CST = 23:00Z (after the change); Saturday's would have been 22:00Z.
    expect(sun.slots.map((s) => s.iso)).toEqual(["2026-11-01T23:00:00.000Z", "2026-11-01T23:30:00.000Z"]);
    expect(mon.slots[0]).toEqual({ iso: "2026-11-02T23:00:00.000Z", label: "5:00 PM" });
    expect(sun.label).toBe("Sun, Nov 1");
    // An early window on the change day: 6:00 AM CST = 12:00Z (one offset read alone gives 11:00Z, 5:00 AM).
    const early = pickupDays(weekdays([0], "06:00", "06:30"), now, deadline).find((d) => d.ymd === "2026-11-01")!;
    expect(early.slots).toEqual([{ iso: "2026-11-01T12:00:00.000Z", label: "6:00 AM" }]);
  });

  it("a day with no window, or whose slots are all past or after the deadline, is left out", () => {
    expect(pickupDays(weekdays([3], "09:00", "12:00"), now, deadline)).toEqual([]);
    expect(pickupDays([], now, deadline)).toEqual([]);
    const fri = pickupDays(weekdays([5], "09:00", "09:30"), now, deadline);
    expect(fri.map((d) => [d.ymd, d.slots.length])).toEqual([["2026-10-30", 1]]);
  });
});
