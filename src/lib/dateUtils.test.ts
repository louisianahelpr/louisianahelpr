import { describe, it, expect } from "vitest";
import { parseLocalDate, formatTimeLeft, jobStartDateTime, hasJobStarted } from "./dateUtils";

describe("formatTimeLeft", () => {
  const now = new Date("2026-07-26T12:00:00");
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

  it("uses one consistent sentence shape across every unit", () => {
    // The whole point of the helper: date-fns' formatDistanceToNow returned
    // "about 22 hours" / "almost 2 days" / "5 days", so the SAME expiry chip
    // read differently card-to-card. Every case here is "<n> <unit> left".
    expect(formatTimeLeft(inMinutes(5 * 1440), now)).toBe("5 days left");
    expect(formatTimeLeft(inMinutes(22 * 60), now)).toBe("22 hours left");
    expect(formatTimeLeft(inMinutes(9), now)).toBe("9 minutes left");
  });

  it("singularises exactly one unit", () => {
    expect(formatTimeLeft(inMinutes(1440), now)).toBe("1 day left");
    expect(formatTimeLeft(inMinutes(60), now)).toBe("1 hour left");
    expect(formatTimeLeft(inMinutes(1), now)).toBe("1 minute left");
  });

  it("floors rather than rounds up, so a deadline never overstates its time", () => {
    // 23h59m must not read "1 day left" — that would promise time that
    // does not exist. Same for 59m, which must not become "1 hour left".
    expect(formatTimeLeft(inMinutes(1439), now)).toBe("23 hours left");
    expect(formatTimeLeft(inMinutes(59), now)).toBe("59 minutes left");
  });

  it("reports Expired at or past the deadline", () => {
    expect(formatTimeLeft(now, now)).toBe("Expired");
    expect(formatTimeLeft(inMinutes(-30), now)).toBe("Expired");
  });
});

describe("parseLocalDate", () => {
  it("parses a YYYY-MM-DD string into a local Date", () => {
    const d = parseLocalDate("2026-04-12");
    expect(d.getFullYear()).toBe(2026);
    // Month is 0-indexed in JS
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(12);
  });

  it("does not shift the date backward in negative-UTC timezones", () => {
    // The whole reason this helper exists. `new Date('2026-04-12')` is
    // parsed as UTC midnight, which becomes Apr 11 in CST/CDT. Our parser
    // must produce a Date whose .getDate() is exactly the day-of-month
    // from the string, regardless of the host's offset.
    const d = parseLocalDate("2026-04-12");
    expect(d.getDate()).toBe(12);
  });

  it("handles single-digit month and day", () => {
    const d = parseLocalDate("2026-01-05");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });

  it("preserves leap-day Feb 29", () => {
    const d = parseLocalDate("2024-02-29");
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it("tolerates a leading ISO timestamp by stripping the time component", () => {
    // Defensive: PostgREST emits DATE columns as YYYY-MM-DD, but a
    // misconfigured caller passing a full ISO timestamp must not produce
    // an Invalid Date — downstream `.toISOString()` would throw, which
    // is what crashed JobDetailDialog in the e2e suite (#325 fallout).
    const d = parseLocalDate("2026-04-12T05:00:00.000Z");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(12);
    // Must be a real Date, not NaN.
    expect(Number.isNaN(d.getTime())).toBe(false);
  });
});

describe("hasJobStarted — the clock gate on the No-Show action", () => {
  // The owner's rule, verbatim: No-Show is tied to the CLOCK, not to whether
  // the helper accepted. Hidden while the job has not started; shown once the
  // scheduled start has come and gone.
  //
  // WHY EVERY "now" HERE IS AN ABSOLUTE INSTANT
  // -------------------------------------------
  // This block used to write `new Date(2026, 7, 18, 8, 0, 0)` for "now" and
  // compare it against a start the implementation ALSO built with the local
  // constructor. Two values in the runtime's zone: the offset cancelled, and
  // every assertion held in every timezone — including the ones where the
  // behaviour was wrong. The suite could not fail for the bug it was covering.
  //
  // That bug was real and shipped. A 2026-09-06 end-to-end review viewing from
  // Pacific found a 6:30 PM Central job counting down two hours late, and the
  // tracker's two-hour "Actions unlock at" gate opening two hours late with it.
  //
  // So: `now` is always `Date.UTC(...)`, the start is resolved in the JOB's
  // zone, and the assertion is between two instants. 2026-08-18 is CDT (UTC-5),
  // so 09:00 Central is 14:00Z — and a January date is CST (UTC-6), which is
  // what proves the offset is taken at the start instant rather than assumed.
  const JOB_DATE = "2026-08-18";
  const at = (...a: [number, number, number, number, number]) => new Date(Date.UTC(...a));

  it("is false an hour BEFORE a 9:00 AM Central job, read from anywhere", () => {
    // The exact case called out: a 9:00 AM job must not offer No-Show at 8 AM.
    expect(hasJobStarted(JOB_DATE, "09:00:00", at(2026, 7, 18, 13, 0))).toBe(false);
  });

  it("is false one minute before the start", () => {
    expect(hasJobStarted(JOB_DATE, "09:00:00", at(2026, 7, 18, 13, 59))).toBe(false);
  });

  it("is true at the start minute and after it", () => {
    expect(hasJobStarted(JOB_DATE, "09:00:00", at(2026, 7, 18, 14, 0))).toBe(true);
    expect(hasJobStarted(JOB_DATE, "09:00:00", at(2026, 7, 18, 14, 1))).toBe(true);
  });

  it("resolves the wall clock in the JOB's zone, not the reader's", () => {
    // 09:00 in Central on a summer date is 14:00Z. Nothing about where this
    // test runs may move that number.
    expect(jobStartDateTime(JOB_DATE, "09:00:00")!.toISOString())
      .toBe("2026-08-18T14:00:00.000Z");
  });

  it("takes the offset AT the start instant, so DST cannot shift it", () => {
    // Same wall clock, opposite side of the DST boundary: CST is UTC-6.
    expect(jobStartDateTime("2026-01-15", "09:00:00")!.toISOString())
      .toBe("2026-01-15T15:00:00.000Z");
    expect(jobStartDateTime("2026-08-18", "09:00:00")!.toISOString())
      .toBe("2026-08-18T14:00:00.000Z");
  });

  it("honours an explicit timezone — the assertion the old shape could not make", () => {
    // Two zones, one wall clock, two different correct instants. This cannot
    // pass vacuously: no single runtime zone satisfies both lines, so a version
    // that ignores the job's zone fails at least one of them wherever it runs.
    expect(jobStartDateTime(JOB_DATE, "09:00:00", "Asia/Tokyo")!.toISOString())
      .toBe("2026-08-18T00:00:00.000Z");
    expect(jobStartDateTime(JOB_DATE, "09:00:00", "UTC")!.toISOString())
      .toBe("2026-08-18T09:00:00.000Z");
  });

  it("treats a flexible-schedule job (no start_time) as midnight in the job's zone", () => {
    expect(jobStartDateTime(JOB_DATE, null)!.toISOString()).toBe("2026-08-18T05:00:00.000Z");
    expect(hasJobStarted(JOB_DATE, null, at(2026, 7, 18, 4, 59))).toBe(false);
    expect(hasJobStarted(JOB_DATE, null, at(2026, 7, 18, 5, 0))).toBe(true);
  });

  it("never accuses anyone on missing data", () => {
    expect(hasJobStarted(null, "09:00:00")).toBe(false);
    expect(hasJobStarted(undefined, null)).toBe(false);
    expect(jobStartDateTime(null)).toBeNull();
  });

  it("refuses an ISO timestamp rather than reading its UTC day as the job day", () => {
    // "2026-08-18T23:00:00Z" is the 18th in UTC and the 18th in Central, but
    // "2026-08-19T02:00:00Z" is the 19th in UTC and still the 18th in Central.
    // Prefix-matching the first ten characters is exactly the confusion this
    // module exists to end, so a timestamp is rejected outright.
    expect(jobStartDateTime("2026-08-19T02:00:00Z", "09:00:00")).toBeNull();
  });
});
