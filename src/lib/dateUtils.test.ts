import { describe, it, expect } from "vitest";
import { parseLocalDate, formatTimeLeft } from "./dateUtils";

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
