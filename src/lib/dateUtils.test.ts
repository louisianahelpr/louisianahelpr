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
  const JOB_DATE = "2026-08-18";

  it("is false an hour BEFORE a 9:00 AM job", () => {
    // The exact case called out: a 9:00 AM job must not offer No-Show at 8 AM.
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 18, 8, 0, 0))).toBe(false);
  });

  it("is false one minute before the start", () => {
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 18, 8, 59, 0))).toBe(false);
  });

  it("is true at the start minute and after it", () => {
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 18, 9, 0, 0))).toBe(true);
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 18, 9, 1, 0))).toBe(true);
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 18, 23, 59, 0))).toBe(true);
  });

  it("is false for any time on an earlier day, and true on a later one", () => {
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 17, 23, 59, 0))).toBe(false);
    expect(hasJobStarted(JOB_DATE, "09:00:00", new Date(2026, 7, 19, 0, 1, 0))).toBe(true);
  });

  it("compares in LOCAL time, never UTC", () => {
    // The trap this helper exists to avoid: parsing "2026-08-18" through
    // `new Date(str)` yields UTC midnight, which in any negative-UTC zone is
    // the PREVIOUS local day — so a job would flip to "started" hours early.
    const start = jobStartDateTime(JOB_DATE, "09:00:00")!;
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);
  });

  it("treats a flexible-schedule job (no start_time) as starting at local midnight", () => {
    expect(hasJobStarted(JOB_DATE, null, new Date(2026, 7, 17, 23, 59, 0))).toBe(false);
    expect(hasJobStarted(JOB_DATE, null, new Date(2026, 7, 18, 0, 0, 0))).toBe(true);
  });

  it("never accuses anyone on missing data", () => {
    expect(hasJobStarted(null, "09:00:00")).toBe(false);
    expect(hasJobStarted(undefined, null)).toBe(false);
    expect(jobStartDateTime(null)).toBeNull();
  });
});
