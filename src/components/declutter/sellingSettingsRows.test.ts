/**
 * The settings rows' words (owner 2026-11-01: "Porch · Home, Mid-City, Baton Rouge · Saturdays", "5% each evening,
 * lowest $8" or "Off", "Never" or "After N days"). Full weekday names, joined naturally; the hours when there are any.
 * Rendered in Your listing and Sell a bunch's list step: declutterSellLastSetup.test.tsx and declutterBunchChoices.test.tsx.
 *
 * @mutate src/components/declutter/SellingSettingsRows.tsx |   return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`; |   return names.join(", ");
 * @mutate src/components/declutter/SellingSettingsRows.tsx |   return days === null ? "Never" : `After ${days} days`; |   return days === null ? "Make it free: never." : `After ${days} days`;
 */
import { describe, expect, it } from "vitest";
import { EMPTY } from "./sellForm";
import { bunchDropsValue, dayWords, daysAndHours, dropsValue, makeFreeValue, pickupLines } from "./SellingSettingsRows";

const SAT_9_12 = [{ weekday: 6, starts: "09:00", ends: "12:00" }];

describe("the settings rows say it in full words", () => {
  it("days: full names, joined naturally", () => {
    expect(dayWords([6])).toBe("Saturdays");
    expect(dayWords([0, 6])).toBe("Sundays and Saturdays");
    expect(dayWords([6, 1, 3])).toBe("Mondays, Wednesdays and Saturdays");
    expect(dayWords([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(dayWords([])).toBe("");
  });

  it("hours come along when there are any", () => {
    expect(daysAndHours(SAT_9_12)).toBe("Saturdays 9:00 AM–12:00 PM");
    expect(daysAndHours(null, [6])).toBe("Saturdays");
    expect(daysAndHours([{ weekday: 6, starts: "09:00", ends: "12:00" }, { weekday: 0, starts: "13:00", ends: "15:00" }])).toBe("Sundays 1:00 PM–3:00 PM; Saturdays 9:00 AM–12:00 PM");
  });

  it("Pickup: one place on one line; several each on their own; none uses the area and usual times", () => {
    const home = { label: "Home", area: "Mid-City, Baton Rouge", weekdays: [6] };
    expect(pickupLines({ ways: ["porch"], places: [home], areaLabel: "", windows: [] })).toEqual(["Porch · Home, Mid-City, Baton Rouge · Saturdays"]);
    expect(pickupLines({ ways: ["porch", "meetup"], places: [home, { label: "Camp", area: "Jeanerette", weekdays: [0], windows: [{ weekday: 0, starts: "13:00", ends: "15:00" }] }], areaLabel: "", windows: [] }))
      .toEqual(["Porch, Safe meeting spot", "Home, Mid-City, Baton Rouge · Saturdays", "Camp, Jeanerette · Sundays 1:00 PM–3:00 PM"]);
    expect(pickupLines({ ways: ["porch"], places: [], areaLabel: "Mid-City", windows: SAT_9_12 })).toEqual(["Porch · Mid-City · Saturdays 9:00 AM–12:00 PM"]);
    expect(pickupLines({ ways: [], places: [], areaLabel: "", windows: [] })).toEqual([]);
  });

  it("Price drops and Make it free, with no sentence around them", () => {
    const f = { ...EMPTY, price: "16", floor: "8", drops: true, dropPct: 5 };
    expect(dropsValue(f)).toBe("5% each evening, lowest $8");
    expect(dropsValue({ ...f, drops: false })).toBe("Off");
    expect(dropsValue({ ...f, floor: "" })).toBe("5% each evening. Set the lowest you'll take.");
    expect(dropsValue({ ...f, free: true })).toBeNull();
    expect(dropsValue({ ...f, price: "" })).toBeNull();
    expect(bunchDropsValue({ drops: true, dropPct: 5, floorPct: 50 })).toBe("5% each evening, lowest 50% of each price");
    expect(bunchDropsValue({ drops: false, dropPct: 5, floorPct: 50 })).toBe("Off");
    expect(makeFreeValue(null)).toBe("Never");
    expect(makeFreeValue(14)).toBe("After 14 days");
  });
});
