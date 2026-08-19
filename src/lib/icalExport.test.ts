import { describe, it, expect } from "vitest";

import { buildIcsString, type CalendarJobEvent } from "./icalExport";

const job: CalendarJobEvent = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Mow the lawn",
  location: "123 Main St, Baton Rouge, LA",
  description: "Front and back",
  dateNeeded: "2026-09-01",
  startTime: "09:00",
  estimatedHours: 2,
};

describe("buildIcsString — field escaping", () => {
  /**
   * Properties are joined with CRLF, so an un-escaped CR inside poster-supplied
   * text ends the property and lets the rest be read as ICS. A poster controls
   * `title`, `location` and `description`, and the helper imports the file
   * because it came from Helpr — the payoff is a forged URL/ATTENDEE, or a
   * whole second VEVENT, inside an event the helper trusts.
   */
  it("neutralizes a bare CR so a poster can't inject their own properties", () => {
    const ics = buildIcsString({ ...job, title: "Mow\rURL:https://evil.example" });
    const summary = ics.split("\r\n").filter((l) => l.startsWith("SUMMARY:"));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toBe("SUMMARY:Mow\\nURL:https://evil.example");
    expect(ics).not.toContain("\r\nURL:");
  });

  it("neutralizes CRLF as a single escape, not two", () => {
    const ics = buildIcsString({ ...job, location: "A\r\nBEGIN:VEVENT" });
    expect(ics).toContain("LOCATION:A\\nBEGIN:VEVENT");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(3); // the real one + the literal text
    expect(ics.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("still escapes backslash, semicolon, comma and LF", () => {
    const ics = buildIcsString({ ...job, title: "a\\b;c,d\ne" });
    expect(ics).toContain("SUMMARY:a\\\\b\\;c\\,d\\ne");
  });

  it("keeps ordinary text intact", () => {
    const ics = buildIcsString(job);
    expect(ics).toContain("SUMMARY:Mow the lawn");
    expect(ics).toContain("LOCATION:123 Main St\\, Baton Rouge\\, LA");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });
});
