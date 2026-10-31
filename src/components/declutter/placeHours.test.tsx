/**
 * LEAD-PLACE-TIMES / LEAD-POST-PLACES (owner 2026-10-31): every pickup place has its own days and hours, and the
 * posting summary and the item page list EVERY place (the owner has 2), each with its own days and times.
 * The server side (hours stored, copied from the usual times, frozen on the order, the buyer's time checked):
 * src/test/pglite/declutterPlaceHours.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |     return `${days.length === 7 ? "Every day" : shortDays(days)} ${range(ws[0])}`; |     return shortDays(days);
 * @mutate src/components/declutter/SellPorchPlaces.tsx |       {places.map((p, i) => ( |       {places.slice(0, 1).map((p, i) => (
 * @mutate src/components/declutter/SellOneScreen.tsx |           {hasPlaces && <MyPickupPlacesSummary />}\n |
 * @mutate src/components/declutter/ItemHandoverTimes.tsx |     {(plan.places \|\| read.isError) && <ItemPickupPlaces itemId={itemId} />}\n |
 */
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeHoursLine } from "./DeclutterPickupTimes";
import { PickupPlacesHoursList } from "./SellPorchPlaces";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "07:00", ends: "21:00" }));

describe("a pickup place's days and hours in words", () => {
  it("same hours every day, some days, and different each day", () => {
    expect(placeHoursLine(EVERY_DAY, [0, 1, 2, 3, 4, 5, 6])).toBe("Every day 7:00 AM–9:00 PM");
    expect(placeHoursLine([{ weekday: 3, starts: "09:00", ends: "12:00" }, { weekday: 1, starts: "09:00", ends: "12:00" }], [1, 3])).toBe("Mon, Wed 9:00 AM–12:00 PM");
    expect(placeHoursLine([{ weekday: 6, starts: "09:00", ends: "12:00" }, { weekday: 0, starts: "13:00", ends: "15:00" }, { weekday: 6, starts: "17:00", ends: "19:00" }], [0, 6]))
      .toBe("Sun 1:00 PM–3:00 PM; Sat 9:00 AM–12:00 PM, 5:00 PM–7:00 PM");
  });
  it("an older server with days only: the days", () => {
    expect(placeHoursLine(null, [6, 0])).toBe("Sun, Sat");
    // Review 2026-10-31: a row with no days and no hours reads as nothing; it never throws and blanks the item page.
    // @mutate src/components/declutter/DeclutterPickupTimes.tsx |   if (!Array.isArray(days)) return ""; |
    expect(placeHoursLine(null, undefined)).toBe("");
    expect(placeHoursLine(undefined, null)).toBe("");
  });
});

describe("every place shows, each with its own days and times", () => {
  it("two saved places: both lines", () => {
    render(<PickupPlacesHoursList places={[
      { label: "Home", area: "New Iberia", weekdays: [0, 1, 2, 3, 4, 5, 6], windows: EVERY_DAY },
      { label: "Camp", area: "Jeanerette", weekdays: [6], windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] },
    ]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Home · New IberiaEvery day 7:00 AM–9:00 PM", "Camp · JeaneretteSat 9:00 AM–12:00 PM"]);
  });
  it("the posting summary and the item page both render the list (source)", () => {
    const sell = readFileSync("src/components/declutter/SellOneScreen.tsx", "utf8");
    const item = readFileSync("src/components/declutter/ItemHandoverTimes.tsx", "utf8");
    expect(sell).toContain("{hasPlaces && <MyPickupPlacesSummary />}");
    expect(item).toContain("<ItemPickupPlaces itemId={itemId} />");
  });
});
