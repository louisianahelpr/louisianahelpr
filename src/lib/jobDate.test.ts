import { describe, it, expect, vi } from "vitest";
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

  it("resolves TODAY in CENTRAL, whatever zone the runner is in", () => {
    // The two tests above CANNOT see the zone revert, which is the whole bug.
    // They build `todayStr` in Central and compare it against `todayMs()`, so
    // if `todayMs()` silently started reading the RUNTIME's zone the two would
    // still name the same calendar day for every hour the two zones agree on
    // the date — 22 hours out of 24 on this runner (America/Los_Angeles), all
    // 24 on a Central one. Verified by mutation 2026-09-21: swapping
    // `America/Chicago` for `America/Los_Angeles` in `todayMs()` left the
    // whole file green.
    //
    // The only honest way to ask is to FREEZE the clock at an instant where
    // the zones disagree about what day it is.
    vi.useFakeTimers();
    try {
      // 01:30 Central on 15 June. Pacific is still on the 14th; UTC is on the
      // 15th. A `todayMs()` reading the runner's zone answers the 14th here
      // and calls a job dated TODAY overdue — the admin-queue bug, exactly.
      vi.setSystemTime(new Date("2026-06-15T06:30:00Z"));
      expect(todayMs()).toBe(jobDateMs("2026-06-15"));
      expect(isPastDue("2026-06-15")).toBe(false);
      expect(isPastDue("2026-06-14")).toBe(true);

      // 19:30 Central on 15 June — the `.toISOString().slice(0,10)` trap: the
      // UTC day is ALREADY the 16th, so any reading anchored on UTC calls a
      // job dated the 16th "today" and a job dated the 15th past due.
      vi.setSystemTime(new Date("2026-06-16T00:30:00Z"));
      expect(new Date().toISOString().slice(0, 10)).toBe("2026-06-16");
      expect(todayMs()).toBe(jobDateMs("2026-06-15"));
      expect(isPastDue("2026-06-15")).toBe(false);
      expect(isPastDue("2026-06-16")).toBe(false);

      // And in WINTER, where Central is UTC-6 rather than UTC-5.
      vi.setSystemTime(new Date("2026-01-15T07:30:00Z")); // 01:30 CST
      expect(todayMs()).toBe(jobDateMs("2026-01-15"));
      expect(isPastDue("2026-01-14")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

// @mutate src/lib/jobDate.ts | const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/; | const BARE_DATE = /^\d{4}-\d{2}-\d{2}/;
// @mutate src/lib/jobDate.ts | timeZone: "America/Chicago", | timeZone: "America/Los_Angeles",
