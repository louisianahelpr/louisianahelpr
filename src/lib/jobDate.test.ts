import { describe, it, expect } from "vitest";
import { jobDateMs, todayMs, isPastDue } from "./jobDate";

/**
 * `jobs.date_needed` has ONE reading.
 *
 * It is a bare YYYY-MM-DD with no zone, and it was parsed four different ways
 * across the codebase — UTC midnight, runtime-local midnight, runtime-local
 * noon, and platform midnight — with one file using two of them fifty lines
 * apart. The one that was actually WRONG rather than merely inconsistent was
 * the admin jobs queue, which compared a UTC-midnight job date against a
 * LOCAL-midnight "today" and therefore flagged every same-day job as overdue.
 *
 * These tests pin the property that bug violated: a job dated TODAY is never
 * past due, whatever zone the process runs in.
 */
describe("job dates resolve in the platform's zone", () => {
  it("a job dated today is not past due", () => {
    // Build 'today' the same way a caller would, from the platform zone.
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    expect(isPastDue(todayStr), `${todayStr} must not be past due`).toBe(false);
  });

  it("today's date and todayMs() agree exactly", () => {
    // The admin bug was precisely these two disagreeing by the UTC offset.
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    expect(jobDateMs(todayStr)).toBe(todayMs());
  });

  it("yesterday is past due and tomorrow is not", () => {
    const day = 24 * 60 * 60 * 1000;
    const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
    expect(isPastDue(fmt(new Date(Date.now() - day)))).toBe(true);
    expect(isPastDue(fmt(new Date(Date.now() + day)))).toBe(false);
  });

  it("is NOT plain UTC-midnight parsing", () => {
    // `new Date("2026-06-15")` is 00:00Z. The platform's midnight is 05:00Z in
    // summer, so the two must differ — if they ever match, the helper has
    // silently reverted to the behaviour that caused the bug.
    expect(jobDateMs("2026-06-15")).not.toBe(new Date("2026-06-15").getTime());
  });

  it("handles null and empty input", () => {
    expect(jobDateMs(null)).toBeNull();
    expect(jobDateMs(undefined)).toBeNull();
    expect(isPastDue(null)).toBe(false);
  });

  it("returns null instead of THROWING on a value that is not a bare date", () => {
    // `jobLocalMidnightMs` splits on "-" and feeds the parts to `Date.UTC`, so
    // anything else yields NaN — and `Intl.DateTimeFormat.formatToParts(new
    // Date(NaN))` throws `RangeError: Invalid time value`. That throw escaped
    // through `isPastDue` into the `useMemo` that buckets the Activity list, so
    // a single unreadable date took /my-posts to the error boundary and every
    // job on the page vanished. Losing the overdue treatment on one card is a
    // far cheaper failure than losing the page.
    for (const bad of ["", "not-a-date", "2026-09-03T04:12:34.567Z", "09/03/2026", "2026-9-3"]) {
      expect(() => jobDateMs(bad), `jobDateMs(${JSON.stringify(bad)}) threw`).not.toThrow();
      expect(jobDateMs(bad), `jobDateMs(${JSON.stringify(bad)})`).toBeNull();
      expect(isPastDue(bad)).toBe(false);
    }
  });

  it("does NOT accept an ISO timestamp by taking its first ten characters", () => {
    // Tempting shortcut, and wrong: those ten characters are the UTC day, and
    // in Central an evening instant is already the NEXT UTC day. Reading
    // "2026-06-15T23:30:00-05:00" as 16 June is the exact off-by-one-day class
    // of bug this module was created to end, so an ISO string is rejected
    // outright rather than truncated into a plausible answer.
    expect(jobDateMs("2026-06-15T23:30:00-05:00")).toBeNull();
    expect(jobDateMs("2026-06-15")).not.toBeNull();
  });
});
