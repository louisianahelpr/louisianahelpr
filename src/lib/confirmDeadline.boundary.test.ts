/**
 * The confirmation window is resolved in America/Chicago, and this is the proof.
 *
 * `jobs.date_needed` is a bare Postgres DATE. The naive reading —
 * `new Date(dateNeeded)` / `toISOString().slice(0, 10)` — lands on UTC
 * midnight, which is 5 or 6 hours off Central. On a 12-hour grace period that
 * is HALF THE WINDOW, and the error is not constant: it changes across DST.
 *
 * So these assert the actual wall-clock instant, formatted back through Intl in
 * the platform zone, rather than an offset arithmetic identity that could be
 * wrong in the same direction as the code.
 */
import { describe, it, expect } from "vitest";
import {
  CONFIRM_WINDOW_HOURS,
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

  it("closes 12 hours later — noon the day before, Central", () => {
    const deadline = confirmDeadlineMs("2026-01-15");
    expect(central(deadline)).toBe("2026-01-14, 12:00");
    expect(deadline - confirmOpensMs("2026-01-15")).toBe(CONFIRM_WINDOW_HOURS * 3_600_000);
  });

  it("holds across the spring-forward boundary (CST → CDT)", () => {
    // DST begins 2026-03-08. A job on the 9th has its window on the 8th, the
    // 23-hour day. The window still OPENS at local midnight — subtracting 24h
    // from the job's midnight would have opened it at 23:00 on the 7th.
    expect(central(confirmOpensMs("2026-03-09"))).toBe("2026-03-08, 00:00");
    // And the grace is twelve ELAPSED hours, which on the short day reads
    // 13:00 rather than noon. That is the honest number: the helper gets the
    // same twelve hours everyone else gets, and the card prints this same
    // instant from this same function, so nothing is quoted that isn't given.
    expect(central(confirmDeadlineMs("2026-03-09"))).toBe("2026-03-08, 13:00");
    expect(confirmDeadlineMs("2026-03-09") - confirmOpensMs("2026-03-09")).toBe(
      CONFIRM_WINDOW_HOURS * 3_600_000,
    );
  });

  it("holds across the fall-back boundary (CDT → CST)", () => {
    // DST ends 2026-11-01, the 25-hour day: twelve elapsed hours from local
    // midnight reads 11:00.
    expect(central(confirmOpensMs("2026-11-02"))).toBe("2026-11-01, 00:00");
    expect(central(confirmDeadlineMs("2026-11-02"))).toBe("2026-11-01, 11:00");
    expect(confirmDeadlineMs("2026-11-02") - confirmOpensMs("2026-11-02")).toBe(
      CONFIRM_WINDOW_HOURS * 3_600_000,
    );
  });

  it("is a full day-and-a-half before the job's own midnight", () => {
    const jobDay = "2026-07-04";
    const opens = confirmOpensMs(jobDay);
    const deadline = confirmDeadlineMs(jobDay);
    expect(deadline - opens).toBe(CONFIRM_WINDOW_HOURS * 3_600_000);
    // Midnight of the job day is a whole (possibly 23- or 25-hour) day after
    // the window opened, which is why CONFIRM_OPENS_HOURS_BEFORE is a
    // DESCRIPTION of the ordinary day and not the arithmetic.
    expect(CONFIRM_OPENS_HOURS_BEFORE).toBe(24);
    expect(central(opens + 24 * 3_600_000)).toBe("2026-07-04, 00:00");
  });

  it("a helper who accepts inside the window gets the grace from their accept", () => {
    const jobDay = "2026-01-15";
    const opens = confirmOpensMs(jobDay);
    // Accepted two hours after the window opened — 02:00 Central on the 14th.
    const accepted = new Date(opens + 2 * 3_600_000).toISOString();
    expect(central(confirmDeadlineMs(jobDay, accepted))).toBe("2026-01-14, 14:00");
    // Accepted long before: the window-open clock governs, not the accept.
    const early = new Date(opens - 9 * 24 * 3_600_000).toISOString();
    expect(confirmDeadlineMs(jobDay, early)).toBe(confirmDeadlineMs(jobDay));
  });

  it("never quotes the card a LATER deadline than the sweep enforces", () => {
    // The card omits accepted_at (the two call sites do not pass the column).
    // Its deadline must therefore never exceed the one the sweep computes with
    // it, or the UI would promise time that does not exist.
    const jobDay = "2026-01-15";
    for (const offsetH of [-72, -24, -1, 0, 1, 6, 11, 13, 30]) {
      const accepted = new Date(confirmOpensMs(jobDay) + offsetH * 3_600_000).toISOString();
      expect(confirmDeadlineMs(jobDay)).toBeLessThanOrEqual(
        confirmDeadlineMs(jobDay, accepted),
      );
    }
  });
});
