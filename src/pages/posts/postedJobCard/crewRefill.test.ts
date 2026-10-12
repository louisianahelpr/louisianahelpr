import { describe, expect, it } from "vitest";
import { crewSpotRefillable } from "./crewRefill";

// @mutate src/pages/posts/postedJobCard/crewRefill.ts |   return filled < needed; |   return false;
// @mutate src/pages/posts/postedJobCard/crewRefill.ts |   const filled = roster.length + (closedSpots ?? 0); |   const filled = roster.length;
// @mutate src/pages/posts/postedJobCard/crewRefill.ts | !roster \|\| closedSpots === undefined) return false; | !roster) return false;
// @mutate src/pages/posts/postedJobCard/crewRefill.ts |   if (cutoff && cutoff.getTime() <= now.getTime() + OFFER_MIN_LEAD_MINUTES * 60_000) return false; |

// Q1378: the poster's card offers a refill on a booked crew with a free spot,
// before the start, and nowhere else.
const NOW = new Date("2024-10-06T15:00:00Z"); // 10:00 CDT
const crew = { is_group_job: true, status: "accepted", helpers_needed: 3, date_needed: "2024-10-08", start_time: "09:00:00" };
const two = [{}, {}];

describe("crewSpotRefillable", () => {
  it("a booked crew of three with two left, days before the start: refillable", () => {
    expect(crewSpotRefillable(crew, two, NOW, 0)).toBe(true);
  });
  it("a full booked crew: not refillable", () => {
    expect(crewSpotRefillable(crew, [{}, {}, {}], NOW, 0)).toBe(false);
  });
  it("a roster row whose account was deleted still holds its spot", () => {
    expect(crewSpotRefillable(crew, [{ helper_id: null }, {}, {}], NOW, 0)).toBe(false);
  });
  it("inside 15 minutes of the start the server refuses a hire, so the card offers none", () => {
    expect(crewSpotRefillable({ ...crew, date_needed: "2024-10-06", start_time: "10:10:00" }, two, NOW, 0)).toBe(false);
    expect(crewSpotRefillable({ ...crew, date_needed: "2024-10-06", start_time: "10:20:00" }, two, NOW, 0)).toBe(true);
  });
  it("not a booked crew: a single job, a staffing (open) crew, a started crew, an unknown roster", () => {
    expect(crewSpotRefillable({ ...crew, is_group_job: false }, two, NOW, 0)).toBe(false);
    expect(crewSpotRefillable({ ...crew, status: "open" }, two, NOW, 0)).toBe(false);
    expect(crewSpotRefillable({ ...crew, status: "in_progress" }, two, NOW, 0)).toBe(false);
    expect(crewSpotRefillable(crew, undefined, NOW, 0)).toBe(false);
  });
  it("Q1498: a spot a block closed is taken, so a crew short only by it is not refillable", () => {
    // Three spots, two on the roster, the third closed by a block (crew_block_fees).
    expect(crewSpotRefillable(crew, two, NOW, 1)).toBe(false);
    // Four spots, two on the roster, one closed: one is still free.
    expect(crewSpotRefillable({ ...crew, helpers_needed: 4 }, two, NOW, 1)).toBe(true);
  });
  it("Q1498: an unknown closed-spot count (not loaded) offers nothing", () => {
    expect(crewSpotRefillable(crew, two, NOW, undefined)).toBe(false);
  });
});
