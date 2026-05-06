import { describe, it, expect } from "vitest";
import { parseLocalDate } from "./dateUtils";

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
});
