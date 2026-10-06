import { describe, expect, it } from "vitest";
import { crewSpotRefillable } from "./crewRefill";

// Q1378: the poster's card offers a refill on a booked crew with a free spot,
// before the start, and nowhere else.
const NOW = new Date("2026-10-06T15:00:00Z"); // 10:00 CDT
const crew = { is_group_job: true, status: "accepted", helpers_needed: 3, date_needed: "2026-10-08", start_time: "09:00:00" };
const two = [{}, {}];

describe("crewSpotRefillable", () => {
  it("a booked crew of three with two left, days before the start: refillable", () => {
    expect(crewSpotRefillable(crew, two, NOW)).toBe(true);
  });
  it("a full booked crew: not refillable", () => {
    expect(crewSpotRefillable(crew, [{}, {}, {}], NOW)).toBe(false);
  });
  it("a roster row whose account was deleted still holds its spot", () => {
    expect(crewSpotRefillable(crew, [{ helper_id: null }, {}, {}], NOW)).toBe(false);
  });
  it("inside 15 minutes of the start the server refuses a hire, so the card offers none", () => {
    expect(crewSpotRefillable({ ...crew, date_needed: "2026-10-06", start_time: "10:10:00" }, two, NOW)).toBe(false);
    expect(crewSpotRefillable({ ...crew, date_needed: "2026-10-06", start_time: "10:20:00" }, two, NOW)).toBe(true);
  });
  it("not a booked crew: a single job, a staffing (open) crew, a started crew, an unknown roster", () => {
    expect(crewSpotRefillable({ ...crew, is_group_job: false }, two, NOW)).toBe(false);
    expect(crewSpotRefillable({ ...crew, status: "open" }, two, NOW)).toBe(false);
    expect(crewSpotRefillable({ ...crew, status: "in_progress" }, two, NOW)).toBe(false);
    expect(crewSpotRefillable(crew, undefined, NOW)).toBe(false);
  });
});
