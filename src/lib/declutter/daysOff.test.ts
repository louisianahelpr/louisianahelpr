/**
 * NIGHT-SET-Declutterse-5: days off are today (Louisiana) up to a year out, and a day not in this year shows its year.
 *
 * @mutate src/lib/declutter/daysOff.ts |   return day >= min && day <= max; |   return day <= max;
 * @mutate src/lib/declutter/daysOff.ts |   last.setUTCDate(last.getUTCDate() + 365); |   last.setUTCDate(last.getUTCDate() + 3650);
 * @mutate src/lib/declutter/daysOff.ts | ...(sameYear ? {} : { year: "numeric" }), | ...{},
 * @mutate src/components/declutter/SellerDeliverySettings.tsx | disabled={!dayOffAllowed(newDay) \|\| | disabled={!newDay \|\|
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { dayOffAllowed, dayOffBounds, dayOffLabel } from "./daysOff";

// 2026-10-31 01:00 UTC is still Oct 30 in Louisiana.
const NOW = new Date("2026-10-31T01:00:00Z");

describe("Declutterse-5: days off", () => {
  it("run from today in Louisiana to a year out", () => {
    expect(dayOffBounds(NOW)).toEqual({ min: "2026-10-30", max: "2027-10-30" });
  });

  it("a past day or one past the year is refused; today and the last day are taken", () => {
    expect(dayOffAllowed("2020-01-01", NOW)).toBe(false);
    expect(dayOffAllowed("2026-10-29", NOW)).toBe(false);
    expect(dayOffAllowed("2026-10-30", NOW)).toBe(true);
    expect(dayOffAllowed("2027-10-30", NOW)).toBe(true);
    expect(dayOffAllowed("2027-10-31", NOW)).toBe(false);
    expect(dayOffAllowed("", NOW)).toBe(false);
  });

  it("shows the year only when the day is not in this year", () => {
    expect(dayOffLabel("2026-11-26", NOW)).toBe("Thu, Nov 26");
    expect(dayOffLabel("2027-01-06", NOW)).toBe("Wed, Jan 6, 2027");
  });

  it("the Add day off button and the date box use the rule", () => {
    const card = blankComments(readFileSync(resolve(__dirname, "../../components/declutter/SellerDeliverySettings.tsx"), "utf8"));
    expect(card).toContain("disabled={!dayOffAllowed(newDay) || daysOff.includes(newDay) || daysOff.length >= 60}");
    expect(card).toContain("min={dayOffBounds().min} max={dayOffBounds().max}");
    expect(card).toContain("{dayOffLabel(d)}");
  });
});
