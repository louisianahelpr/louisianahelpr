import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  // THE CASE ABOVE CANNOT SEE THE BUG IT DESCRIBES, AND NEITHER CAN A RE-ZONED
  // ONE. Every machine this suite runs on sits at a NEGATIVE offset
  // (America/Los_Angeles here, America/Chicago on the owner's Mac, UTC in CI),
  // and local midnight at a negative offset still lands on the same UTC day —
  // so `new Date(`${ymd}T00:00:00`)` round-trips through
  // `toISOString().slice(0,10)` unchanged and the assertion above passes on the
  // broken code. The zones only disagree east of UTC.
  //
  // Re-zoning the process mid-suite does NOT work either: probed 2026-09-21,
  // `process.env.TZ = "Asia/Tokyo"` inside a vitest worker leaves
  // `Intl.DateTimeFormat().resolvedOptions().timeZone` at America/Los_Angeles
  // and `new Date("2026-09-07T00:00:00").toISOString()` at 07:00Z — Node has
  // already cached the zone by the time a test body runs. A test that sets TZ
  // and then asserts would be five copies of the same LA case.
  //
  // So assert the PROPERTY that makes the zone irrelevant: this module never
  // mixes a local-time read or write with a UTC one. Both halves are checked —
  // the client mirror the Post-a-Task preview quotes from, and the edge
  // authority the charge cron bills from — because a drift in either is the
  // same money bug.
  it("never reads or writes a date in local time — in EITHER half of the pair", () => {
    const sources = [
      ["src/lib/recurringSchedule.ts", readFileSync(resolve(process.cwd(), "src/lib/recurringSchedule.ts"), "utf8")],
      [
        "supabase/functions/_shared/recurringSchedule.ts",
        readFileSync(resolve(process.cwd(), "supabase/functions/_shared/recurringSchedule.ts"), "utf8"),
      ],
    ] as const;
    expect(sources.length).toBeGreaterThan(1);

    for (const [file, src] of sources) {
      // A date-only string must be pinned to an explicit UTC instant. Without
      // the `Z` the engine parses it as local midnight, and `toISOString()`
      // then names the PREVIOUS day everywhere east of Greenwich.
      expect(src, `${file}: date-only parsing is no longer pinned to UTC`).toMatch(
        /new Date\(`\$\{\w+\}T\d\d:\d\d:\d\dZ`\)/,
      );
      // And no local-time accessor anywhere: getDay/getDate/setDate/getMonth/
      // getFullYear read and write the machine's zone, so one of them beside a
      // toISOString() is the mixed pair that moves the whole series.
      const local = [...src.matchAll(/\.(get|set)(Day|Date|Month|FullYear|Hours)\b/g)].map((m) => m[0]);
      expect(local, `${file} reads/writes local time: ${local.join(", ")}`).toEqual([]);
    }
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

// A poster's series is a schedule of unattended card charges. The ceiling is
// the only thing between a bad `weeks` and a year of them.
// @mutate src/lib/recurringSchedule.ts | Math.min(Math.floor(weeks), MAX_RECURRENCE_WEEKS) | Math.floor(weeks)
// Noon UTC, not local midnight: the whole series moves a day otherwise. Only
// visible in a POSITIVE-offset zone — see the per-timezone cases above.
// @mutate src/lib/recurringSchedule.ts | new Date(`${ymd}T12:00:00Z`) | new Date(`${ymd}T00:00:00`)
// Week 1 is the week CONTAINING the start; dates before the job itself are not
// backdated visits the poster gets billed for.
// @mutate src/lib/recurringSchedule.ts | if (d < start) continue; | if (false) continue;
