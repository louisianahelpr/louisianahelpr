import { describe, it, expect } from "vitest";

import {
  MAX_RECURRENCE_WEEKS,
  recurringVisitDates,
  seriesTotalDollars,
  upcomingVisitDates,
  visitCount,
} from "./recurringSchedule";

/** 2026-09-07 is a Monday. */
const MON = "2026-09-07";

describe("recurringVisitDates", () => {
  it("expands Mon/Wed/Fri for three weeks", () => {
    expect(recurringVisitDates(MON, [1, 3, 5], 3)).toEqual([
      "2026-09-07", "2026-09-09", "2026-09-11",
      "2026-09-14", "2026-09-16", "2026-09-18",
      "2026-09-21", "2026-09-23", "2026-09-25",
    ]);
  });

  it("counts week 1 as the week CONTAINING the start, not seven days from it", () => {
    // Posted on Wednesday: the Monday of that same week is in the past and is
    // excluded, so a 3-week series is 8 visits, not 9. This is what a poster
    // means by "for the next three weeks" — they do not expect a visit
    // backdated to before they posted.
    const dates = recurringVisitDates("2026-09-09", [1, 3, 5], 3);
    expect(dates[0]).toBe("2026-09-09");
    expect(dates).not.toContain("2026-09-07");
    expect(dates).toHaveLength(8);
  });

  it("returns dates in chronological order", () => {
    const dates = recurringVisitDates(MON, [5, 1, 3], 2);
    expect([...dates].sort()).toEqual(dates);
  });

  it("handles a single weekday for a year", () => {
    expect(recurringVisitDates("2026-09-02", [3], 52)).toHaveLength(52);
  });

  it("caps at MAX_RECURRENCE_WEEKS rather than trusting the caller", () => {
    // The week count is how long a saved card can be charged unattended, so an
    // out-of-range value must not simply be honoured.
    expect(recurringVisitDates("2026-09-02", [3], 500)).toHaveLength(MAX_RECURRENCE_WEEKS);
  });

  it("is empty for the degenerate inputs rather than guessing", () => {
    expect(recurringVisitDates("", [1], 3)).toEqual([]);
    expect(recurringVisitDates(MON, [], 3)).toEqual([]);
    expect(recurringVisitDates(MON, [1], 0)).toEqual([]);
    expect(recurringVisitDates("not-a-date", [1], 3)).toEqual([]);
    expect(recurringVisitDates(MON, [9, -1], 3)).toEqual([]);
  });

  it("does not shift a day under a negative-offset timezone", () => {
    // Parsing a date-only string at midnight and rendering it in, say, UTC-6
    // lands on the previous day — which would move every visit in the series.
    // Monday in, Monday out.
    const [first] = recurringVisitDates(MON, [1], 1);
    expect(first).toBe(MON);
  });
});

describe("upcomingVisitDates", () => {
  it("drops the first visit, which the parent job already paid for", () => {
    const all = recurringVisitDates(MON, [1, 3], 2);
    expect(upcomingVisitDates(MON, [1, 3], 2)).toEqual(all.slice(1));
    expect(upcomingVisitDates(MON, [1, 3], 2)).not.toContain(MON);
  });
});

describe("seriesTotalDollars", () => {
  it("multiplies the PER-VISIT budget by the visit count", () => {
    expect(visitCount(MON, [1, 3, 5], 3)).toBe(9);
    expect(seriesTotalDollars(50, MON, [1, 3, 5], 3)).toBe(450);
  });

  it("is zero without a budget", () => {
    expect(seriesTotalDollars(0, MON, [1], 3)).toBe(0);
  });
});
