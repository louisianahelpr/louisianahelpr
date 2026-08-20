import { describe, it, expect } from "vitest";

import * as app from "./recurringSchedule";
import * as edge from "../../supabase/functions/_shared/recurringSchedule";

/**
 * The app quotes the series total from its copy; the charge cron bills the
 * poster's saved card from the edge copy. A divergence here is not a display
 * bug — it is either a charge for a visit the poster was never shown, or a
 * helper turning up on a date nobody paid for. Same guard shape as
 * posterFees/helperFees/stripeFees/salesTax.
 */
const CASES: Array<[string, number[], number]> = [
  // Mon/Wed/Fri for 3 weeks, starting on a Monday — the owner's example.
  ["2026-09-07", [1, 3, 5], 3],
  // Started mid-week: week 1 is the week CONTAINING the start, so the Monday
  // before it is excluded.
  ["2026-09-09", [1, 3, 5], 3],
  // Every Wednesday for a year — the long-run case.
  ["2026-09-02", [3], 52],
  // Whole week.
  ["2026-09-01", [0, 1, 2, 3, 4, 5, 6], 2],
  // Weekend only.
  ["2026-09-05", [0, 6], 4],
  // Single week, single day.
  ["2026-09-04", [5], 1],
  // Start date is the only wanted weekday and sits at the end of the week.
  ["2026-09-05", [6], 3],
];

describe("recurringSchedule — client/edge parity", () => {
  it.each(CASES)("agrees on the dates for %s / %j / %i weeks", (start, days, weeks) => {
    expect(app.recurringVisitDates(start, days, weeks)).toEqual(
      edge.recurringVisitDates(start, days, weeks),
    );
  });

  it.each(CASES)("agrees on the billable visits for %s / %j / %i weeks", (start, days, weeks) => {
    expect(app.upcomingVisitDates(start, days, weeks)).toEqual(
      edge.upcomingVisitDates(start, days, weeks),
    );
  });

  it("agrees on the series total", () => {
    for (const [start, days, weeks] of CASES) {
      expect(app.seriesTotalDollars(50, start, days, weeks)).toBe(
        edge.seriesTotalDollars(50, start, days, weeks),
      );
    }
  });

  it("shares the same week cap", () => {
    expect(app.MAX_RECURRENCE_WEEKS).toBe(edge.MAX_RECURRENCE_WEEKS);
  });
});
