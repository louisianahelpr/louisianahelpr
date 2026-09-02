import { describe, it, expect } from "vitest";
import { buildJobICS } from "@/lib/calendarExport";

const baseJob = {
  id: "job-123",
  title: "Move a couch",
  location: "123 Main St, Baton Rouge, LA",
  description: "Need help moving a couch up two flights of stairs.",
  dateNeeded: "2026-09-15",
  startTime: "14:30",
  estimatedHours: 2,
};

describe("buildJobICS", () => {
  it("produces a well-formed VEVENT with timed start/end", () => {
    const ics = buildJobICS(baseJob);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:job-job-123@louisianahelpr.com");
    expect(ics).toContain("DTSTART:20260915T143000");
    expect(ics).toContain("DTEND:20260915T163000"); // +2 hours
    expect(ics).toContain("SUMMARY:Move a couch");
    expect(ics).toContain("LOCATION:123 Main St\\, Baton Rouge\\, LA");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    // CRLF line endings per RFC 5545
    expect(ics.includes("\r\n")).toBe(true);
  });

  it("omits the LOCATION property entirely for an anonymised job", () => {
    // A poster who deletes their account leaves the job standing with
    // `location` NULL (20260901033011). This file leaves the app and lands in
    // someone's real calendar, so the property must be ABSENT rather than
    // present-and-empty: an absent property is what iCalendar means by
    // "unknown", while `LOCATION:` asserts the event has no location.
    const ics = buildJobICS({ ...baseJob, location: null });
    expect(ics).not.toContain("LOCATION:");
    // The rest of the event must still be well-formed — a missing address
    // degrades one property, it does not invalidate the invitation.
    expect(ics).toContain("SUMMARY:Move a couch");
    expect(ics).toContain("DTSTART:20260915T143000");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("still writes LOCATION when the address is present", () => {
    // Guards the spread in buildJobICS: the omission above must not have
    // made the property conditional on something other than nullness.
    expect(buildJobICS(baseJob)).toContain("LOCATION:123 Main St\\, Baton Rouge\\, LA");
  });

  it("defaults to a 2-hour duration when estimatedHours is missing", () => {
    const ics = buildJobICS({ ...baseJob, estimatedHours: null });
    expect(ics).toContain("DTSTART:20260915T143000");
    expect(ics).toContain("DTEND:20260915T163000");
  });

  it("falls back to an all-day event when startTime is 'flexible' or null", () => {
    const flexible = buildJobICS({ ...baseJob, startTime: "flexible" });
    expect(flexible).toContain("DTSTART;VALUE=DATE:20260915");
    expect(flexible).toContain("DTEND;VALUE=DATE:20260916");

    const nullTime = buildJobICS({ ...baseJob, startTime: null });
    expect(nullTime).toContain("DTSTART;VALUE=DATE:20260915");
  });

  it("escapes commas, semicolons, and backslashes in text fields", () => {
    const ics = buildJobICS({
      ...baseJob,
      title: "Fix; clean, sort\\stuff",
    });
    expect(ics).toContain("SUMMARY:Fix\\; clean\\, sort\\\\stuff");
  });

  it("folds long lines at 75 octets per RFC 5545", () => {
    const longDescription = "A".repeat(200);
    const ics = buildJobICS({ ...baseJob, description: longDescription });
    const physicalLines = ics.split("\r\n");
    for (const line of physicalLines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Continuation lines start with a single leading space.
    const descLineIndex = physicalLines.findIndex((l) => l.startsWith("DESCRIPTION:"));
    expect(physicalLines[descLineIndex + 1]?.startsWith(" ")).toBe(true);
  });
});
