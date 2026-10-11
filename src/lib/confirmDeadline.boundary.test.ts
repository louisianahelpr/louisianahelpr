/**
 * The confirmation window and deadline are resolved in America/Chicago, and
 * this is the proof.
 *
 * `jobs.date_needed` is a bare Postgres DATE. The naive reading —
 * `new Date(dateNeeded)` / `toISOString().slice(0, 10)` — lands on UTC
 * midnight, which is 5 or 6 hours off Central: longer than the whole 2-hour
 * notice, and the error changes across DST.
 *
 * So these assert the actual wall-clock instant, formatted back through Intl in
 * the platform zone, rather than an offset arithmetic identity that could be
 * wrong in the same direction as the code.
 */
import { describe, it, expect } from "vitest";
import {
  CONFIRM_DEADLINE_HOURS_BEFORE_START,
  CONFIRM_OPENS_HOURS_BEFORE,
  confirmOpensMs,
  confirmDeadlineMs,
} from "./jobDate";

/** What an instant reads as on a Louisiana wall clock. */
function central(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** And in UTC, which is what the naive reading would have produced. */
function utc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", ", ");
}

describe("confirm window · timezone", () => {
  it("opens at midnight the day before, Central — not UTC", () => {
    // CST (standard time): Central is UTC-6.
    const opens = confirmOpensMs("2026-01-15");
    expect(central(opens)).toBe("2026-01-14, 00:00");
    // The same instant in UTC is the 14th at 06:00 — i.e. a UTC-based reading
    // would have opened the window six hours early.
    expect(utc(opens)).toBe("2026-01-14, 06:00");
  });

  it("is owed until 2 hours before the START, Central (owner, 2026-10-08)", () => {
    expect(CONFIRM_DEADLINE_HOURS_BEFORE_START).toBe(2);
    expect(central(confirmDeadlineMs("2026-01-15", "10:00"))).toBe("2026-01-15, 08:00");
    expect(central(confirmDeadlineMs("2026-01-15", "14:30:00"))).toBe("2026-01-15, 12:30");
    // No start time: the job day's midnight, as the SQL sweep's COALESCE(start_time, '00:00').
    expect(central(confirmDeadlineMs("2026-01-15", null))).toBe("2026-01-14, 22:00");
  });

  it("holds across the spring-forward boundary (CST to CDT)", () => {
    // DST begins 2026-03-08. A job on the 9th has its window on the 8th, the
    // 23-hour day. The window still OPENS at local midnight — subtracting 24h
    // from the job's midnight would have opened it at 23:00 on the 7th.
    expect(central(confirmOpensMs("2026-03-09"))).toBe("2026-03-08, 00:00");
    // A 03:30 start on the switch day itself: two ELAPSED hours before it is
    // 00:30 CST, because 02:00-02:59 never happens (the instant the SQL's
    // timestamptz arithmetic gives too).
    expect(central(confirmDeadlineMs("2026-03-08", "03:30"))).toBe("2026-03-08, 00:30");
  });

  it("holds across the fall-back boundary (CDT to CST)", () => {
    // DST ends 2026-11-01, the 25-hour day.
    expect(central(confirmOpensMs("2026-11-02"))).toBe("2026-11-01, 00:00");
    expect(central(confirmDeadlineMs("2026-11-01", "09:00"))).toBe("2026-11-01, 07:00");
  });

  it("the window opens before the deadline for every start on the job day", () => {
    const jobDay = "2026-07-04";
    const opens = confirmOpensMs(jobDay);
    for (const t of ["00:00", "01:59", "02:00", "09:00", "23:59"]) {
      expect(confirmDeadlineMs(jobDay, t)).toBeGreaterThan(opens);
    }
    // Midnight of the job day is a whole (possibly 23- or 25-hour) day after
    // the window opened, which is why CONFIRM_OPENS_HOURS_BEFORE is a
    // DESCRIPTION of the ordinary day and not the arithmetic.
    expect(CONFIRM_OPENS_HOURS_BEFORE).toBe(24);
    expect(central(opens + 24 * 3_600_000)).toBe("2026-07-04, 00:00");
  });
});
// The naive reading this file was written against: subtract 24h from the job's
// own midnight instead of taking the previous CALENDAR day. On spring-forward
// the window opens at 23:00 two days early; on fall-back at 01:00.
// @mutate supabase/functions/_shared/confirmDeadline.ts | return jobLocalMidnightMs(previousDay(dateNeeded)); | return jobLocalMidnightMs(dateNeeded) - CONFIRM_OPENS_HOURS_BEFORE * HOUR_MS;
