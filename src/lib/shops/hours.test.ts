/**
 * A shop's hours in Louisiana time (src/lib/shops/hours.ts), shared by the shop
 * page and the Browse card, plus the per-group placeholder icon a shop with no
 * cover photo shows (src/lib/shops/categoryIcons.ts).
 */
import { describe, expect, it } from "vitest";
import { Store, Utensils } from "lucide-react";
import { fmtTime, louisianaNow, openStatus } from "./hours";
import { shopGroupIcon } from "./categoryIcons";

// 2026-10-20 (a Tuesday) 15:30 UTC = 10:30 in Louisiana (CDT, UTC-5).
const TUE_1030 = new Date("2026-10-20T15:30:00Z");
// 2026-10-20 04:00 UTC = Monday 23:00 in Louisiana: the device's UTC day is wrong.
const MON_2300 = new Date("2026-10-20T04:00:00Z");

describe("shop hours", () => {
  it("formats times as 12-hour, minutes only when set", () => {
    expect(fmtTime("09:00")).toBe("9 AM");
    expect(fmtTime("00:00")).toBe("12 AM");
    expect(fmtTime("12:00")).toBe("12 PM");
    expect(fmtTime("17:30")).toBe("5:30 PM");
    expect(fmtTime("08:05")).toBe("8:05 AM");
  });

  it("reads the weekday and time in Louisiana, whatever the device's zone", () => {
    expect(louisianaNow(TUE_1030)).toEqual({ weekday: 2, hhmm: "10:30" });
    expect(louisianaNow(MON_2300)).toEqual({ weekday: 1, hhmm: "23:00" });
  });

  it("is null when the shop set no hours", () => {
    expect(openStatus([], TUE_1030)).toBeNull();
  });

  it("says open now and until when", () => {
    expect(openStatus([{ weekday: 2, opens: "09:00", closes: "17:00" }], TUE_1030)).toEqual({ open: true, label: "Open now · until 5 PM" });
  });

  it("says when it opens next: later today, tomorrow, or a named day", () => {
    expect(openStatus([{ weekday: 2, opens: "13:00", closes: "17:00" }, { weekday: 2, opens: "11:00", closes: "12:00" }], TUE_1030)).toEqual({
      open: false,
      label: "Closed · opens today 11 AM",
    });
    expect(openStatus([{ weekday: 3, opens: "08:30", closes: "17:00" }], TUE_1030)).toEqual({ open: false, label: "Closed · opens tomorrow 8:30 AM" });
    expect(openStatus([{ weekday: 5, opens: "09:00", closes: "17:00" }], TUE_1030)).toEqual({ open: false, label: "Closed · opens Friday 9 AM" });
  });

  it("closing time is exclusive", () => {
    expect(openStatus([{ weekday: 2, opens: "08:00", closes: "10:30" }], TUE_1030)?.open).toBe(false);
  });
});

describe("shop group icon", () => {
  it("maps a group to its icon and anything unknown to the shop icon", () => {
    expect(shopGroupIcon("food_to_order")).toBe(Utensils);
    expect(shopGroupIcon("nope")).toBe(Store);
    expect(shopGroupIcon(null)).toBe(Store);
    expect(shopGroupIcon(undefined)).toBe(Store);
  });
});

// @mutate src/lib/shops/hours.ts | const h12 = hh % 12 === 0 ? 12 : hh % 12; | const h12 = hh % 12 === 0 ? 0 : hh % 12;
// @mutate src/lib/shops/hours.ts | h.opens <= hhmm && hhmm < h.closes | h.opens <= hhmm && hhmm <= h.closes
